import type { MiddlewareFn } from '@sukujs/core';
import { mutable } from './util.js';

export type CspDirectives = Record<string, string | string[]>;

export interface SecurityHeadersOptions {
  /**
   * `Strict-Transport-Security`: tells browsers to use HTTPS only.
   * Default: 180 days, including subdomains. `false` to omit.
   */
  hsts?: false | { maxAge?: number; includeSubDomains?: boolean; preload?: boolean };
  /**
   * `Content-Security-Policy`. The default suits an API: nothing may be loaded and the
   * response may not be framed. Pass directives for an app that serves HTML, or `false`.
   */
  contentSecurityPolicy?: false | string | CspDirectives;
  /** `X-Frame-Options`. Default `DENY`. */
  frameOptions?: false | 'DENY' | 'SAMEORIGIN';
  /** `Referrer-Policy`. Default `no-referrer`. */
  referrerPolicy?: false | string;
  /** `Cross-Origin-Opener-Policy`. Default `same-origin`. */
  crossOriginOpenerPolicy?: false | string;
  /** `Cross-Origin-Resource-Policy`. Default `same-origin`. Use `cross-origin` for public assets. */
  crossOriginResourcePolicy?: false | string;
  /** `X-Content-Type-Options: nosniff`. Default `true`. */
  noSniff?: boolean;
  /** `Permissions-Policy`. Off by default; pass a value such as `camera=(), geolocation=()`. */
  permissionsPolicy?: false | string;
  /** Any additional headers to set on every response. */
  extra?: Record<string, string>;
}

const API_CSP: CspDirectives = {
  'default-src': "'none'",
  'frame-ancestors': "'none'",
  'base-uri': "'none'",
  'form-action': "'none'",
};

/** Serialises directives: `{ 'img-src': ["'self'", 'data:'] }` -> `img-src 'self' data:`. */
export function buildCsp(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${Array.isArray(value) ? value.join(' ') : value}`.trim())
    .join('; ');
}

/**
 * Sets the standard defensive response headers. A header the handler already set is left
 * alone, so one route can loosen a policy without turning it off everywhere.
 *
 * ```ts
 * Suku.create({ middlewares: [securityHeaders()] });
 * ```
 */
export function securityHeaders(options: SecurityHeadersOptions = {}): MiddlewareFn {
  const headers: [string, string][] = [];
  const add = (name: string, value: string | false | undefined, fallback: string) => {
    if (value !== false) headers.push([name, value ?? fallback]);
  };

  if (options.hsts !== false) {
    const hsts = options.hsts ?? {};
    let value = `max-age=${hsts.maxAge ?? 15_552_000}`;
    if (hsts.includeSubDomains ?? true) value += '; includeSubDomains';
    if (hsts.preload) value += '; preload';
    headers.push(['strict-transport-security', value]);
  }
  const csp = options.contentSecurityPolicy;
  if (csp !== false) {
    headers.push([
      'content-security-policy',
      typeof csp === 'string' ? csp : buildCsp(csp ?? API_CSP),
    ]);
  }
  if (options.noSniff ?? true) headers.push(['x-content-type-options', 'nosniff']);
  add('x-frame-options', options.frameOptions, 'DENY');
  add('referrer-policy', options.referrerPolicy, 'no-referrer');
  add('cross-origin-opener-policy', options.crossOriginOpenerPolicy, 'same-origin');
  add('cross-origin-resource-policy', options.crossOriginResourcePolicy, 'same-origin');
  if (options.permissionsPolicy) headers.push(['permissions-policy', options.permissionsPolicy]);
  for (const [name, value] of Object.entries(options.extra ?? {}))
    headers.push([name.toLowerCase(), value]);

  return async (_ctx, next) => {
    const response = mutable(await next());
    for (const [name, value] of headers) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
    return response;
  };
}
