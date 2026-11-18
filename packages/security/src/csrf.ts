import { ForbiddenException, type MiddlewareFn, type RequestContext } from '@sukujs/core';
import { createSigner, randomToken, timingSafeEqual } from '@sukujs/crypto';
import { matchesOrigin, mutable, type OriginRule } from './util';

interface CsrfCommon {
  /** Methods that never change state and are not checked. Default: GET, HEAD, OPTIONS. */
  safeMethods?: string[];
  /** Skip the check for some requests, e.g. a webhook route verified by signature. */
  skip?: (ctx: RequestContext) => boolean;
}

export interface CsrfOriginOptions extends CsrfCommon {
  mode?: 'origin';
  /**
   * Other origins allowed to make state-changing requests, such as a front end on another
   * domain. The request's own origin is always allowed.
   */
  allowedOrigins?: OriginRule[];
}

export interface CsrfTokenOptions extends CsrfCommon {
  mode: 'token';
  /** Signs the token cookie. At least 32 bytes. */
  secret: string;
  /**
   * Cookie that carries the token. Default `__Host-csrf`, or `csrf` when the cookie is not
   * `Secure`, has a `domain`, or has a `path` other than `/`. The `__Host-` prefix makes
   * browsers refuse a cookie of that name set by a sibling subdomain or over plain HTTP.
   */
  cookieName?: string;
  /**
   * Ties the token to the caller's session, so a token issued to one session is rejected
   * on another. Return the session id, or `undefined` for a visitor without a session.
   * When the session changes (login, logout) the old token stops working and a new one is
   * issued on the next request.
   */
  sessionId?: (ctx: RequestContext) => string | undefined;
  /** Header the client must echo the token in. Default `x-csrf-token`. */
  headerName?: string;
  /** Cookie attributes. Default: `Path=/; SameSite=Lax; Secure`. Never `HttpOnly`: scripts must read it. */
  cookie?: {
    path?: string;
    sameSite?: 'Lax' | 'Strict' | 'None';
    secure?: boolean;
    domain?: string;
  };
}

export type CsrfOptions = CsrfOriginOptions | CsrfTokenOptions;

const TOKEN = Symbol.for('suku:csrf-token');
const DEFAULT_SAFE = ['GET', 'HEAD', 'OPTIONS'];
/** The random part of a token, as `randomToken` produces it. */
const VALUE = /^[A-Za-z0-9_-]+$/;

/** The CSRF token for this request (token mode), to embed in a form or page. */
export function csrfToken(ctx: RequestContext): string | undefined {
  return ctx.get<string>(TOKEN);
}

function reject(): never {
  throw new ForbiddenException('Cross-site request blocked');
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * Cross-Site Request Forgery protection for apps that authenticate with cookies. APIs that
 * only accept an `Authorization` header do not need it.
 *
 * The default `origin` mode needs no token or storage: it rejects state-changing requests
 * that browsers mark as coming from another site. `token` mode is the classic signed
 * double-submit cookie, for clients that cannot rely on those headers.
 *
 * ```ts
 * Suku.create({ middlewares: [csrf()] });
 * ```
 */
export function csrf(options: CsrfOptions = {}): MiddlewareFn {
  const safe = new Set((options.safeMethods ?? DEFAULT_SAFE).map((m) => m.toUpperCase()));
  const skip = options.skip;

  if (options.mode !== 'token') {
    const allowed = options.allowedOrigins ?? [];
    return async (ctx, next) => {
      if (safe.has(ctx.method) || skip?.(ctx)) return next();
      const site = ctx.headers.get('sec-fetch-site');
      // Browsers set this header themselves; a page cannot forge it.
      if (site === 'same-origin' || site === 'none') return next();
      const origin = ctx.headers.get('origin');
      if (origin === null) {
        // No Origin and no cross-site marker: not a browser making a cross-site request.
        if (site === null) return next();
        reject();
      }
      if (matchesOrigin(origin, allowed)) return next();
      let host: string | undefined;
      try {
        host = new URL(origin).host;
      } catch {
        reject();
      }
      // Compared by host, because TLS is often terminated before the app sees the request.
      if (host === ctx.url.host && site !== 'cross-site') return next();
      reject();
    };
  }

  if (typeof options.secret !== 'string' || options.secret.length < 32) {
    throw new TypeError('csrf: token mode needs a `secret` of at least 32 characters.');
  }
  const signer = createSigner(options.secret);
  const headerName = options.headerName ?? 'x-csrf-token';
  const sessionId = options.sessionId;
  const c = options.cookie ?? {};
  const path = c.path ?? '/';
  const secure = c.secure ?? true;
  const hostOnly = secure && !c.domain && path === '/';
  const cookieName = options.cookieName ?? (hostOnly ? '__Host-csrf' : 'csrf');
  if (cookieName.startsWith('__Host-') && !hostOnly) {
    throw new TypeError(
      'csrf: a `__Host-` cookie must be Secure, have no `domain` and use `path: "/"`; browsers drop it otherwise.',
    );
  }
  const attributes =
    `; Path=${path}; SameSite=${c.sameSite ?? 'Lax'}` +
    (secure ? '; Secure' : '') +
    (c.domain ? `; Domain=${c.domain}` : '');

  // What is signed: the random value alone, or the value and the session id. The value is
  // base64url and so has no dot, which keeps the two forms from being mistaken for each other.
  const signed = (value: string, session: string | undefined) =>
    session === undefined ? value : `${value}.${session}`;
  const issue = async (session: string | undefined) => {
    const value = randomToken(18);
    return `${value}.${await signer.sign(signed(value, session))}`;
  };
  const check = async (token: string | undefined, session: string | undefined) => {
    if (token === undefined) return false;
    const at = token.indexOf('.');
    if (at === -1) return false;
    const value = token.slice(0, at);
    if (!VALUE.test(value)) return false;
    return signer.verify(signed(value, session), token.slice(at + 1));
  };

  return async (ctx, next) => {
    if (skip?.(ctx)) return next();
    const session = sessionId?.(ctx);
    const presented = readCookie(ctx.headers.get('cookie'), cookieName);
    const valid = await check(presented, session);

    if (!safe.has(ctx.method)) {
      const echoed = ctx.headers.get(headerName);
      if (!valid || echoed === null || !timingSafeEqual(echoed, presented as string)) reject();
    }

    const token = valid ? (presented as string) : await issue(session);
    ctx.set(TOKEN, token);
    const response = await next();
    if (valid) return response;
    const out = mutable(response);
    out.headers.append('set-cookie', `${cookieName}=${token}${attributes}`);
    return out;
  };
}
