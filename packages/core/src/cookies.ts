export interface CookieOptions {
  /** Lifetime in seconds. Omit for a session cookie that ends when the browser closes. */
  maxAge?: number;
  /** Absolute expiry. Prefer `maxAge`. */
  expires?: Date;
  /** Default `/`. */
  path?: string;
  domain?: string;
  /** Hide the cookie from page scripts. Default `true`. */
  httpOnly?: boolean;
  /** Send only over HTTPS. Default `true`. Browsers still accept it on `http://localhost`, except Safari. */
  secure?: boolean;
  /** Default `Lax`. `None` requires `secure`. */
  sameSite?: 'Lax' | 'Strict' | 'None';
  /** Partitioned (CHIPS) cookie, for embedded third-party contexts. */
  partitioned?: boolean;
}

const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Parses a `Cookie` request header into names and decoded values. */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"'))
      value = value.slice(1, -1);
    try {
      out[name] = value.includes('%') ? decodeURIComponent(value) : value;
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** Builds a `Set-Cookie` header value. The value is URL-encoded. */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!NAME.test(name)) throw new TypeError(`Invalid cookie name: ${JSON.stringify(name)}`);
  const sameSite = options.sameSite ?? 'Lax';
  const secure = options.secure ?? true;
  if (sameSite === 'None' && !secure)
    throw new TypeError('A SameSite=None cookie must also be Secure.');
  let out = `${name}=${encodeURIComponent(value)}; Path=${options.path ?? '/'}`;
  if (options.domain) out += `; Domain=${options.domain}`;
  if (options.maxAge !== undefined) {
    if (!Number.isFinite(options.maxAge))
      throw new TypeError('Cookie maxAge must be a number of seconds.');
    out += `; Max-Age=${Math.floor(options.maxAge)}`;
  }
  if (options.expires) out += `; Expires=${options.expires.toUTCString()}`;
  if (options.httpOnly ?? true) out += '; HttpOnly';
  if (secure) out += '; Secure';
  out += `; SameSite=${sameSite}`;
  if (options.partitioned) out += '; Partitioned';
  return out;
}

/**
 * Cookies of the current request and response, as `ctx.cookies`. Reading comes from the
 * request; `set` and `delete` are applied to whatever response is finally sent.
 */
export class Cookies {
  private parsed: Record<string, string> | undefined;

  constructor(
    private readonly header: string | null,
    private readonly responseHeaders: () => Headers,
  ) {}

  private get values(): Record<string, string> {
    return (this.parsed ??= parseCookies(this.header));
  }

  /** The cookie the client sent, or `undefined`. */
  get(name: string): string | undefined {
    return this.values[name];
  }

  has(name: string): boolean {
    return name in this.values;
  }

  /** Every cookie the client sent. */
  all(): Readonly<Record<string, string>> {
    return this.values;
  }

  /** Sets a cookie on the response. Defaults: `Path=/; HttpOnly; Secure; SameSite=Lax`. */
  set(name: string, value: string, options?: CookieOptions): this {
    this.responseHeaders().append('set-cookie', serializeCookie(name, value, options));
    return this;
  }

  /** Tells the browser to remove a cookie. `path` and `domain` must match how it was set. */
  delete(
    name: string,
    options: Pick<CookieOptions, 'path' | 'domain' | 'secure' | 'sameSite'> = {},
  ): this {
    return this.set(name, '', { ...options, maxAge: 0, expires: new Date(0) });
  }
}
