import type { MiddlewareFn, RequestContext } from '@sukujs/core';
import { appendVary, matchesOrigin, mutable, type OriginRule } from './util.js';

export interface CorsOptions {
  /**
   * Which origins may read responses.
   * - `'*'` (default): any origin. Not allowed together with `credentials`.
   * - a string, RegExp, or list of them: exact origins such as `https://app.example.com`.
   * - a function: decide per request.
   */
  origin?:
    | '*'
    | OriginRule
    | OriginRule[]
    | ((origin: string, ctx: RequestContext) => boolean | Promise<boolean>);
  /** Methods allowed for cross-origin requests. Default: GET, HEAD, PUT, PATCH, POST, DELETE. */
  methods?: string[];
  /** Request headers the browser may send. Default: whatever the preflight asks for. */
  allowedHeaders?: string[];
  /** Response headers scripts may read, beyond the safelisted ones. */
  exposedHeaders?: string[];
  /** Allow cookies and `Authorization` on cross-origin requests. Default `false`. */
  credentials?: boolean;
  /** Seconds a browser may cache a preflight result. Default 600. */
  maxAge?: number;
}

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];

/**
 * Cross-Origin Resource Sharing. Answers preflight requests itself and adds the
 * `Access-Control-*` headers to every other response, including errors and 404s.
 * Register it at the app level so it runs for unmatched routes too.
 *
 * ```ts
 * Suku.create({ middlewares: [cors({ origin: ['https://app.example.com'], credentials: true })] });
 * ```
 */
export function cors(options: CorsOptions = {}): MiddlewareFn {
  const rule = options.origin ?? '*';
  const credentials = options.credentials ?? false;
  if (rule === '*' && credentials) {
    throw new TypeError(
      'cors: `origin: "*"` cannot be combined with `credentials: true`; browsers reject it. List the allowed origins instead.',
    );
  }
  const methods = (options.methods ?? DEFAULT_METHODS).map((m) => m.toUpperCase()).join(', ');
  const allowedHeaders = options.allowedHeaders?.join(', ');
  const exposedHeaders = options.exposedHeaders?.length
    ? options.exposedHeaders.join(', ')
    : undefined;
  const maxAge = String(options.maxAge ?? 600);
  const wildcard = rule === '*';
  const rules = typeof rule === 'function' || wildcard ? [] : Array.isArray(rule) ? rule : [rule];

  const isAllowed = async (origin: string, ctx: RequestContext): Promise<boolean> => {
    if (wildcard) return true;
    if (typeof rule === 'function') return rule(origin, ctx);
    return matchesOrigin(origin, rules);
  };

  const apply = (headers: Headers, origin: string) => {
    headers.set('access-control-allow-origin', wildcard ? '*' : origin);
    if (credentials) headers.set('access-control-allow-credentials', 'true');
    if (exposedHeaders) headers.set('access-control-expose-headers', exposedHeaders);
  };

  return async (ctx, next) => {
    const origin = ctx.headers.get('origin');
    const preflight =
      ctx.method === 'OPTIONS' &&
      origin !== null &&
      ctx.headers.has('access-control-request-method');

    if (preflight) {
      const headers = new Headers();
      if (!wildcard) appendVary(headers, 'Origin');
      if (await isAllowed(origin, ctx)) {
        apply(headers, origin);
        headers.delete('access-control-expose-headers');
        headers.set('access-control-allow-methods', methods);
        const requested = allowedHeaders ?? ctx.headers.get('access-control-request-headers');
        if (requested) {
          headers.set('access-control-allow-headers', requested);
          if (!allowedHeaders) appendVary(headers, 'Access-Control-Request-Headers');
        }
        headers.set('access-control-max-age', maxAge);
      }
      // A disallowed origin gets no CORS headers, which makes the browser block the request.
      return new Response(null, { status: 204, headers });
    }

    const response = mutable(await next());
    // The response differs by origin, so caches must not share it between origins.
    if (!wildcard) appendVary(response.headers, 'Origin');
    if (origin !== null && (await isAllowed(origin, ctx))) apply(response.headers, origin);
    return response;
  };
}
