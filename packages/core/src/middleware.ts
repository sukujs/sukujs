import type { Constructor } from '@suku/di';
import type { RequestContext } from './context.js';
import { ForbiddenException } from './http-errors.js';

export type Next = () => Promise<Response>;

/**
 * The one cross-cutting concept. A middleware wraps the rest of the request: run code
 * before, call `next()`, run code after. Returning without calling `next()` short-circuits;
 * throwing an `HttpException` rejects the request.
 */
export type MiddlewareFn = (ctx: RequestContext, next: Next) => Response | Promise<Response>;

/** Class form, for middlewares that need injected services. */
export interface Middleware {
  use(ctx: RequestContext, next: Next): Response | Promise<Response>;
}

/** A function, an instance, or a class resolved through the container. */
export type MiddlewareRef = MiddlewareFn | Middleware | Constructor<Middleware>;

/** Maps an error to a response. Return nothing to let the next handler, or the default, deal with it. */
export type ErrorHandler = (
  error: unknown,
  ctx: RequestContext,
) => Response | undefined | void | Promise<Response | undefined | void>;

/** Identity helper that types an inline middleware. */
export function middleware(fn: MiddlewareFn): MiddlewareFn {
  return fn;
}

/**
 * A middleware that only decides whether the request may continue. `false` is a 403.
 *
 * ```ts
 * const adminOnly = allow((ctx) => ctx.get<User>('user')?.role === 'admin');
 * ```
 */
export function allow(
  check: (ctx: RequestContext) => boolean | Promise<boolean>,
  message = 'Forbidden',
): MiddlewareFn {
  return async (ctx, next) => {
    if (!(await check(ctx))) throw new ForbiddenException(message);
    return next();
  };
}
