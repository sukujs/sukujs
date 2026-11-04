import type { Constructor } from '@suku/di';
import type { RequestContext } from './context.js';

export type Next<T> = () => Promise<T>;

/** Runs around everything, including unmatched routes. Call `next()` to continue. */
export interface Middleware {
  use(ctx: RequestContext, next: Next<Response>): Response | Promise<Response>;
}
export type MiddlewareFn = (
  ctx: RequestContext,
  next: Next<Response>,
) => Response | Promise<Response>;

/** Decides whether the handler may run. `false` becomes a 403. */
export interface Guard {
  canActivate(ctx: RequestContext): boolean | Promise<boolean>;
}
export type GuardFn = (ctx: RequestContext) => boolean | Promise<boolean>;

/**
 * Wraps the handler call. `next()` resolves to the handler's raw return value, before it is
 * turned into a `Response`, so interceptors can transform results or measure time.
 */
export interface Interceptor {
  intercept(ctx: RequestContext, next: Next<unknown>): unknown;
}
export type InterceptorFn = (ctx: RequestContext, next: Next<unknown>) => unknown;

export interface ArgumentMetadata {
  /** `Param`, `Query`, `Body`, `Headers`, ... or a custom decorator's name. */
  readonly kind: string;
  /** The decorator's argument, e.g. the parameter name. */
  readonly data: unknown;
  readonly index: number;
  /** The TypeScript type of the handler parameter, when emitted. */
  readonly type: Function | undefined;
  readonly ctx: RequestContext;
}

/** Transforms or validates one handler argument. Throw an `HttpException` to reject it. */
export interface Pipe<I = unknown, O = unknown> {
  transform(value: I, metadata: ArgumentMetadata): O | Promise<O>;
}
export type PipeFn = (value: unknown, metadata: ArgumentMetadata) => unknown;

/**
 * Turns an error into a `Response`. Return `undefined` to let the next filter try.
 * Restrict with `@Catch(SomeError)`; unrestricted filters see every error.
 */
export interface ExceptionFilter {
  catch(error: unknown, ctx: RequestContext): Response | undefined | Promise<Response | undefined>;
}
export type FilterFn = (
  error: unknown,
  ctx: RequestContext,
) => Response | undefined | Promise<Response | undefined>;

/** A pipeline piece: a class (resolved from the request scope), an instance, or a function. */
export type Ref<T, F> = Constructor<T> | T | F;
export type MiddlewareRef = Ref<Middleware, MiddlewareFn>;
export type GuardRef = Ref<Guard, GuardFn>;
export type InterceptorRef = Ref<Interceptor, InterceptorFn>;
export type PipeRef = Ref<Pipe, PipeFn>;
export type FilterRef = Ref<ExceptionFilter, FilterFn>;

export interface Enhancers {
  middleware: MiddlewareRef[];
  guards: GuardRef[];
  interceptors: InterceptorRef[];
  pipes: PipeRef[];
  filters: FilterRef[];
  /** Values set with `@SetMetadata`, read by guards through `ctx.getMetadata(key)`. */
  metadata: Map<unknown, unknown>;
}

export type EnhancerKind = 'middleware' | 'guards' | 'interceptors' | 'pipes' | 'filters';

export function emptyEnhancers(): Enhancers {
  return {
    middleware: [],
    guards: [],
    interceptors: [],
    pipes: [],
    filters: [],
    metadata: new Map(),
  };
}
