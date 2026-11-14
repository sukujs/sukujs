import type { Token } from '@sukujs/di';
import type { RequestContext } from './context.js';
import type { ErrorHandler, MiddlewareRef } from './middleware.js';
import type { InferInput, InferOutput, StandardSchema } from './schema.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ALL';

type AnySchema = StandardSchema<any, any>;
type MaybePromise<T> = T | Promise<T>;

type Segment<S extends string> = S extends `:${infer N}`
  ? N
  : S extends `*${infer N}`
    ? N extends ''
      ? '*'
      : N
    : never;
/** Names of the `:param` and `*wildcard` segments in a path literal. */
export type PathParams<P extends string> = P extends `${infer A}/${infer B}`
  ? Segment<A> | PathParams<B>
  : Segment<P>;

type RawParams<P extends string> = string extends P
  ? Record<string, string>
  : { [K in PathParams<P>]: string };
type Out<S, Fallback> = S extends AnySchema ? InferOutput<S> : Fallback;

/** Services a route asks for: `{ users: UsersService }` arrives as `{ users }` in the handler. */
export type ServiceMap = Record<string, Token>;
export type ResolvedServices<S> = { [K in keyof S]: S[K] extends Token<infer T> ? T : never };

/** What a handler receives. Each part is typed by its schema, or is the raw value without one. */
export type RouteInput<P extends string, TP, TQ, TB, TH, TS> = {
  /** Route parameters: the schema's output, or strings keyed by the path's parameter names. */
  params: Out<TP, RawParams<P>>;
  /** Query string: the schema's output, or strings (arrays for repeated keys). */
  query: Out<TQ, Record<string, string | string[]>>;
  /** Parsed body. Only read when a `body` schema is declared; use `ctx.body()` otherwise. */
  body: Out<TB, undefined>;
  /** Headers: the schema's output, or the `Headers` object. */
  headers: Out<TH, Headers>;
  ctx: RequestContext;
  request: Request;
} & ResolvedServices<TS>;

export interface RouteOptions<P extends string, TP, TQ, TB, TH, TR, TS> {
  /** Validates route parameters. Must cover every `:param` in the path. */
  params?: TP;
  query?: TQ;
  body?: TB;
  headers?: TH;
  /** Validates (and strips) the returned value, and documents the route. */
  response?: TR;
  /** Services resolved from the request scope and passed to the handler by name. */
  services?: TS;
  middlewares?: MiddlewareRef[];
  onError?: ErrorHandler;
  /** Success status. Default 200, or 201 for POST. */
  status?: number;
  /** Identity in logs, the route table and generated clients. Defaults to the field or group key. */
  name?: string;
  /** Free-form data for middlewares, read with `ctx.route.meta`. */
  meta?: Record<string, unknown>;
  handle: (
    input: RouteInput<P, TP, TQ, TB, TH, TS>,
  ) => MaybePromise<TR extends AnySchema ? InferInput<TR> | Response : unknown>;
}

const ROUTE: unique symbol = Symbol.for('suku:route');
const GROUP: unique symbol = Symbol.for('suku:route-group');

/** Erased view of a route's options, as the kernel consumes them. */
export interface RouteConfig {
  params?: AnySchema;
  query?: AnySchema;
  body?: AnySchema;
  headers?: AnySchema;
  response?: AnySchema;
  services?: ServiceMap;
  middlewares?: MiddlewareRef[];
  onError?: ErrorHandler;
  status?: number;
  name?: string;
  meta?: Record<string, unknown>;
  handle: (input: any) => unknown;
}

export interface Route<M extends HttpMethod = HttpMethod, P extends string = string> {
  readonly [ROUTE]: true;
  readonly method: M;
  readonly path: P;
  readonly config: RouteConfig;
}

export interface GroupOptions {
  middlewares?: MiddlewareRef[];
  onError?: ErrorHandler;
}

export interface RouteGroup {
  readonly [GROUP]: true;
  readonly prefix: string;
  readonly options: GroupOptions;
  readonly routes: Readonly<Record<string, Route | RouteGroup>>;
}

export function isRoute(value: unknown): value is Route {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[ROUTE] === true
  );
}

export function isRouteGroup(value: unknown): value is RouteGroup {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[GROUP] === true
  );
}

type ParamsSchemaFor<P extends string> = StandardSchema<any, { [K in PathParams<P>]: unknown }>;

function define<M extends HttpMethod>(method: M) {
  return <
    const P extends string,
    TP extends ParamsSchemaFor<P> | undefined = undefined,
    TQ extends AnySchema | undefined = undefined,
    TB extends AnySchema | undefined = undefined,
    TH extends AnySchema | undefined = undefined,
    TR extends AnySchema | undefined = undefined,
    TS extends ServiceMap = {},
  >(
    path: P,
    options: RouteOptions<P, TP, TQ, TB, TH, TR, TS>,
  ): Route<M, P> => ({ [ROUTE]: true, method, path, config: options as unknown as RouteConfig });
}

function group(prefix: string, routes: Record<string, Route | RouteGroup>): RouteGroup;
function group(
  prefix: string,
  options: GroupOptions,
  routes: Record<string, Route | RouteGroup>,
): RouteGroup;
function group(
  prefix: string,
  a: GroupOptions | Record<string, Route | RouteGroup>,
  b?: Record<string, Route | RouteGroup>,
): RouteGroup {
  return b === undefined
    ? { [GROUP]: true, prefix, options: {}, routes: a as Record<string, Route | RouteGroup> }
    : { [GROUP]: true, prefix, options: a as GroupOptions, routes: b };
}

/**
 * Declares a route. The schemas type the handler's argument, and the path literal is checked
 * against the `params` schema at compile time.
 *
 * ```ts
 * route.get('/users/:id', {
 *   params: z.object({ id: z.coerce.number() }),
 *   services: { users: UsersService },
 *   handle: ({ params, users }) => users.find(params.id),
 * });
 * ```
 */
export const route = {
  get: define('GET'),
  post: define('POST'),
  put: define('PUT'),
  patch: define('PATCH'),
  delete: define('DELETE'),
  head: define('HEAD'),
  options: define('OPTIONS'),
  all: define('ALL'),
  /** Shares a prefix, middlewares and an error handler between routes, without a class. */
  group,
};

/** A redirect response, for returning from a handler. */
export function redirect(url: string, status = 302): Response {
  return new Response(null, { status, headers: { location: url } });
}
