import { type MiddlewareFn, type RequestContext, TooManyRequestsException } from '@sukujs/core';
import { type Duration, mutable, toSeconds } from './util';

export interface RateLimitHit {
  /** Requests counted in the current window, including this one. */
  count: number;
  /** When the window ends, in milliseconds since the epoch. */
  resetAt: number;
}

/** Where counters live. Implement this over Redis or similar to share limits between instances. */
export interface RateLimitStore {
  hit(key: string, windowMs: number, now: number): RateLimitHit | Promise<RateLimitHit>;
}

/**
 * Counters in this process's memory, in fixed windows. Correct for a single instance; with
 * several instances each one counts separately, so the effective limit is multiplied.
 *
 * Memory is bounded by `maxKeys`. When the store is full of live counters, new keys share
 * one overflow counter until room frees up: a flood of new keys can then be limited as a
 * group, but it cannot push out, and so reset, the counters of clients already being limited.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, RateLimitHit>();
  private overflow: RateLimitHit | undefined;
  private sinceSweep = 0;
  private sweptAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly maxKeys = 100_000) {}

  hit(key: string, windowMs: number, now: number): RateLimitHit {
    if (++this.sinceSweep >= SWEEP_EVERY_HITS) this.sweep(now);
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!entry && this.entries.size >= this.maxKeys) {
        // Walking the map is the expensive part, so a full store is swept at most once a second.
        if (now - this.sweptAt >= SWEEP_INTERVAL_MS) this.sweep(now);
        if (this.entries.size >= this.maxKeys) return this.hitOverflow(windowMs, now);
      }
      entry = { count: 0, resetAt: now + windowMs };
      this.entries.set(key, entry);
    }
    entry.count++;
    return entry;
  }

  get size(): number {
    return this.entries.size;
  }

  private hitOverflow(windowMs: number, now: number): RateLimitHit {
    if (!this.overflow || this.overflow.resetAt <= now) {
      this.overflow = { count: 0, resetAt: now + windowMs };
    }
    this.overflow.count++;
    return this.overflow;
  }

  private sweep(now: number): void {
    this.sinceSweep = 0;
    this.sweptAt = now;
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
  }
}

const SWEEP_EVERY_HITS = 1000;
const SWEEP_INTERVAL_MS = 1000;

/**
 * What the default limiter counts by for an address. IPv4 addresses are used whole. An IPv6
 * client usually controls a whole /64, so those are grouped by that prefix; otherwise one
 * client could spread its requests over as many addresses as it liked and never be limited.
 */
function addressKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const address = (ip.split('%')[0] as string).toLowerCase();
  if (address.startsWith('::ffff:') && address.includes('.')) return address.slice(7);
  const [head = '', tail, extra] = address.split('::');
  if (extra !== undefined) return ip;
  const groups = (part: string) => {
    const out = part === '' ? [] : part.split(':');
    // A dotted IPv4 tail stands for two groups.
    return out.at(-1)?.includes('.') ? [...out, ''] : out;
  };
  const front = groups(head);
  let all = front;
  if (tail !== undefined) {
    const back = groups(tail);
    const missing = 8 - front.length - back.length;
    if (missing < 1) return ip;
    all = [...front, ...new Array<string>(missing).fill('0'), ...back];
  }
  if (all.length !== 8) return ip;
  const prefix = all.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, ''));
  return `${prefix.join(':')}::/64`;
}

/**
 * The client's IP address. Without `trustProxy` it is the socket's peer, which behind a
 * reverse proxy is the proxy itself. Set `trustProxy` to the number of proxies in front of
 * the app (or `true` for one) to read `X-Forwarded-For` instead. Never trust that header
 * when clients can reach the app directly: they can set it to anything.
 */
export function clientIp(
  ctx: RequestContext,
  trustProxy: boolean | number = false,
): string | undefined {
  const hops = trustProxy === true ? 1 : trustProxy === false ? 0 : trustProxy;
  if (hops <= 0) return ctx.remoteAddress;
  const forwarded = ctx.headers.get('x-forwarded-for');
  if (!forwarded) return ctx.remoteAddress;
  const chain = forwarded
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (ctx.remoteAddress) chain.push(ctx.remoteAddress);
  return chain[chain.length - 1 - hops] ?? chain[0];
}

export interface RateLimitOptions {
  /** Requests allowed per window, per key. */
  limit: number;
  /** Window length: seconds, or a string such as `1m`, `15m`, `1h`. */
  window: Duration;
  /**
   * What is being limited. Default: the client IP, with IPv6 addresses grouped by their /64
   * prefix. Return a user id to limit per account,
   * or `undefined` to let the request through uncounted.
   */
  key?: (ctx: RequestContext) => string | undefined | Promise<string | undefined>;
  /** Proxies in front of the app, for the default IP key. See `clientIp`. */
  trustProxy?: boolean | number;
  /** Default: a `MemoryRateLimitStore` private to this limiter. */
  store?: RateLimitStore;
  /** Separates this limiter's counters when a store is shared. Default: generated. */
  name?: string;
  /** Send `RateLimit-*` headers. Default `true`. */
  headers?: boolean;
  /** Body message of the 429. */
  message?: string;
  /** Requests to leave uncounted, e.g. health checks. */
  skip?: (ctx: RequestContext) => boolean;
  /** Clock in milliseconds. For tests. */
  now?: () => number;
}

let limiters = 0;

/**
 * Limits how many requests a client may make in a time window. Over the limit it answers
 * `429 Too Many Requests` with `Retry-After`.
 *
 * ```ts
 * route.post('/auth/login', { middlewares: [rateLimit({ limit: 5, window: '1m' })], handle });
 * ```
 */
export function rateLimit(options: RateLimitOptions): MiddlewareFn {
  if (!Number.isInteger(options.limit) || options.limit < 1)
    throw new TypeError('rateLimit: `limit` must be a positive integer.');
  const windowMs = toSeconds(options.window) * 1000;
  const store = options.store ?? new MemoryRateLimitStore();
  const name = options.name ?? `rl${++limiters}`;
  const sendHeaders = options.headers ?? true;
  const now = options.now ?? Date.now;
  const keyOf =
    options.key ??
    ((ctx: RequestContext) => {
      const ip = clientIp(ctx, options.trustProxy);
      return ip === undefined ? 'unknown' : addressKey(ip);
    });

  return async (ctx, next) => {
    if (options.skip?.(ctx)) return next();
    const key = await keyOf(ctx);
    if (key === undefined) return next();

    const at = now();
    const { count, resetAt } = await store.hit(`${name}:${key}`, windowMs, at);
    const reset = String(Math.max(1, Math.ceil((resetAt - at) / 1000)));
    const info: Record<string, string> = sendHeaders
      ? {
          'ratelimit-limit': String(options.limit),
          'ratelimit-remaining': String(Math.max(0, options.limit - count)),
          'ratelimit-reset': reset,
        }
      : {};

    if (count > options.limit) {
      return new TooManyRequestsException(
        options.message ?? 'Too many requests, please try again later',
        {
          headers: { ...info, 'retry-after': reset },
        },
      ).toResponse();
    }

    const response = await next();
    if (!sendHeaders) return response;
    const out = mutable(response);
    for (const [header, value] of Object.entries(info)) out.headers.set(header, value);
    return out;
  };
}
