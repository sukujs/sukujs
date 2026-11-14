import {
  type Constructor,
  getServiceOptions,
  isConstructor,
  type ServiceProvider,
  tokenName,
} from '@sukujs/di';
import type { FetchHandler } from './adapter.js';
import { RequestContext, type RequestSettings, type RouteInfo } from './context.js';
import type { Feature } from './feature.js';
import {
  HttpException,
  InternalServerErrorException,
  MethodNotAllowedException,
  NotFoundException,
} from './http-errors.js';
import { Logger } from './logger.js';
import type { ErrorHandler, Middleware, MiddlewareFn, MiddlewareRef } from './middleware.js';
import { toResponse } from './response.js';
import { isRoute, isRouteGroup, type Route, type RouteConfig, type RouteGroup } from './route.js';
import { Router } from './router.js';
import { getRoutesMetadata } from './routes-class.js';
import { FeatureError, type ScanResult } from './scanner.js';
import { validate } from './schema.js';
import { pathnameOf } from './url.js';

export interface KernelOptions {
  /** Prepended to every route, e.g. `'/api'`. */
  prefix?: string;
  /** Middlewares for every request, matched or not. Run before feature and route middlewares. */
  middlewares?: MiddlewareRef[];
  /**
   * Last error handler before the default rendering. Return a `Response` to answer, or nothing
   * to fall through (unhandled non-HTTP errors are logged and answered with a 500).
   */
  onError?: ErrorHandler;
  /** Maximum request body size in bytes. Default 1 MiB. */
  bodyLimit?: number;
}

interface Compiled {
  readonly method: string;
  readonly config: RouteConfig;
  /** For routes on a non-singleton `@Routes` class: where to find the per-request route. */
  readonly owner?: { cls: Constructor; field: string };
  readonly services: [string, unknown][];
  readonly middlewares: readonly MiddlewareRef[];
  readonly errorHandlers: readonly ErrorHandler[];
  readonly info: RouteInfo;
}

/** Maps a request scope to its context so `RequestContext` can be injected. */
const contexts = new WeakMap<ServiceProvider, RequestContext>();

export function contextOf(scope: ServiceProvider): RequestContext | undefined {
  return contexts.get(scope);
}

export function joinPaths(...parts: (string | undefined)[]): string {
  const segments: string[] = [];
  for (const p of parts) if (p) for (const s of p.split('/')) if (s) segments.push(s);
  return `/${segments.join('/')}`;
}

export interface RouteTableEntry {
  method: string;
  path: string;
  name: string;
}

export interface Kernel {
  readonly handle: FetchHandler;
  /** For diagnostics and tests. */
  readonly routes: readonly RouteTableEntry[];
  /** App-level middlewares. Mutable so `app.use()` can add to it. */
  readonly middlewares: MiddlewareRef[];
}

const EMPTY_PARAMS: Readonly<Record<string, string>> = Object.freeze({});
const EMPTY_META: Readonly<Record<string, unknown>> = Object.freeze({});

interface Scope {
  prefix: string;
  middlewares: readonly MiddlewareRef[];
  /** Most specific first. */
  errorHandlers: readonly ErrorHandler[];
}

export function createKernel(
  scan: ScanResult,
  provider: ServiceProvider,
  options: KernelOptions = {},
): Kernel {
  const router = new Router<Compiled>();
  const table: RouteTableEntry[] = [];
  const globalMiddlewares: MiddlewareRef[] = [...(options.middlewares ?? [])];
  const settings: RequestSettings = {
    body: options.bodyLimit === undefined ? {} : { limit: options.bodyLimit },
  };
  const logger = () => provider.getOptional(Logger);

  // --- compile ---------------------------------------------------------------

  const addRoute = (r: Route, key: string | undefined, scope: Scope, owner?: Compiled['owner']) => {
    const path = joinPaths(scope.prefix, r.path);
    const name = r.config.name ?? key ?? `${r.method} ${path}`;
    for (const [serviceName, token] of Object.entries(r.config.services ?? {})) {
      if (!provider.has(token)) {
        throw new FeatureError(
          `Route ${name} asks for service "${serviceName}" (${tokenName(token)}), which is not registered. ` +
            'Add it to the `services` of a feature or of Suku.create().',
        );
      }
    }
    const compiled: Compiled = {
      method: r.method,
      config: r.config,
      ...(owner ? { owner } : {}),
      services: Object.entries(r.config.services ?? {}),
      middlewares: [...scope.middlewares, ...(r.config.middlewares ?? [])],
      errorHandlers: r.config.onError
        ? [r.config.onError, ...scope.errorHandlers]
        : scope.errorHandlers,
      info: { method: r.method, path, name, meta: r.config.meta ?? EMPTY_META },
    };
    router.add(r.method, path, compiled);
    table.push({ method: r.method, path, name });
  };

  const addGroup = (g: RouteGroup, key: string | undefined, scope: Scope) => {
    const inner: Scope = {
      prefix: joinPaths(scope.prefix, g.prefix),
      middlewares: [...scope.middlewares, ...(g.options.middlewares ?? [])],
      errorHandlers: g.options.onError
        ? [g.options.onError, ...scope.errorHandlers]
        : scope.errorHandlers,
    };
    for (const [childKey, child] of Object.entries(g.routes)) {
      const name = key ? `${key}.${childKey}` : childKey;
      if (isRoute(child)) addRoute(child, name, inner);
      else if (isRouteGroup(child)) addGroup(child, name, inner);
      else throw new FeatureError(`"${name}" in a route group is not a route.`);
    }
  };

  const addClass = (cls: Constructor, scope: Scope) => {
    const meta = getRoutesMetadata(cls)!;
    const singleton = isSingleton(cls);
    let instance: Record<string, unknown>;
    let probe: ServiceProvider | undefined;
    try {
      if (singleton) {
        instance = provider.get(cls) as Record<string, unknown>;
      } else {
        // Routes live on instances, so one is built at startup to discover them.
        probe = provider.createScope();
        instance = probe.get(cls) as Record<string, unknown>;
      }
    } catch (cause) {
      throw new FeatureError(
        `Could not construct ${cls.name} at startup to discover its routes: ${(cause as Error).message}` +
          (singleton
            ? ''
            : ' A scoped @Routes class must be constructible without a live request; take request-bound ' +
              "services through a route's `services` option instead of the constructor."),
        { cause },
      );
    }
    const inner: Scope = {
      prefix: joinPaths(scope.prefix, meta.prefix),
      middlewares: [...scope.middlewares, ...(meta.middlewares ?? [])],
      errorHandlers: meta.onError ? [meta.onError, ...scope.errorHandlers] : scope.errorHandlers,
    };
    let count = 0;
    for (const field of Object.keys(instance)) {
      const value = instance[field];
      if (!isRoute(value)) continue;
      count++;
      addRoute(value, `${cls.name}.${field}`, inner, singleton ? undefined : { cls, field });
    }
    void probe?.dispose();
    if (count === 0) {
      throw new FeatureError(
        `${cls.name} is decorated with @Routes() but declares no route fields. Add one with route.get(...).`,
      );
    }
  };

  const isSingleton = (cls: Constructor): boolean => {
    const lifetime =
      getRoutesMetadata(cls)?.lifetime ?? getServiceOptions(cls)?.lifetime ?? 'singleton';
    return lifetime === 'singleton';
  };

  const featureScope = (f: Feature): Scope => ({
    prefix: joinPaths(options.prefix, f.prefix),
    middlewares: f.middlewares ?? [],
    errorHandlers: f.onError ? [f.onError] : [],
  });

  for (const { entry, feature } of scan.entries) {
    const scope = featureScope(feature);
    if (isRoute(entry)) addRoute(entry, undefined, scope);
    else if (isRouteGroup(entry)) addGroup(entry, undefined, scope);
    else addClass(entry, scope);
  }

  // --- middlewares -----------------------------------------------------------

  /** Unregistered singleton middleware classes, constructed once through the container. */
  const activated = new Map<Constructor, Middleware>();

  function resolveMiddleware(ref: MiddlewareRef, ctx: RequestContext): MiddlewareFn | Middleware {
    if (!isConstructor(ref)) return ref as MiddlewareFn | Middleware;
    const cls = ref as Constructor<Middleware>;
    if (provider.has(cls)) return ctx.provider.get(cls);
    const lifetime = getServiceOptions(cls)?.lifetime ?? 'singleton';
    if (lifetime !== 'singleton') return ctx.provider.create(cls);
    let instance = activated.get(cls);
    if (!instance) {
      instance = provider.create(cls);
      activated.set(cls, instance);
    }
    return instance;
  }

  function runMiddlewares(
    list: readonly MiddlewareRef[],
    ctx: RequestContext,
    final: () => Promise<Response>,
    render: (error: unknown) => Promise<Response>,
  ) {
    let reached = -1;
    const next = (index: number): Promise<Response> => {
      if (index <= reached)
        return Promise.reject(new Error('next() called more than once in a middleware'));
      reached = index;
      if (index === list.length) return final();
      const mw = resolveMiddleware(list[index]!, ctx);
      // An error thrown further in is rendered before it returns here, so `next()` always
      // yields a Response. Otherwise a 401 from an inner middleware would skip the outer
      // ones on its way out and lose, for example, its CORS headers.
      const step = async () => {
        try {
          return await next(index + 1);
        } catch (error) {
          return render(error);
        }
      };
      return Promise.resolve(typeof mw === 'function' ? mw(ctx, step) : mw.use(ctx, step));
    };
    return next(0);
  }

  // --- handler ---------------------------------------------------------------

  async function invoke(c: Compiled, ctx: RequestContext): Promise<Response> {
    const config = c.owner
      ? ((ctx.provider.get(c.owner.cls) as Record<string, Route>)[c.owner.field]?.config ??
        c.config)
      : c.config;

    const input: Record<string, unknown> = {
      ctx,
      request: ctx.request,
      params: config.params ? await validate(config.params, ctx.params, 'params') : ctx.params,
      body: config.body ? await validate(config.body, await ctx.body(), 'body') : undefined,
      headers: config.headers
        ? await validate(config.headers, Object.fromEntries(ctx.request.headers), 'headers')
        : ctx.request.headers,
    };
    if (config.query) {
      input.query = await validate(config.query, ctx.query, 'query');
    } else {
      // Parsing the URL is deferred until a handler actually reads `query`.
      Object.defineProperty(input, 'query', {
        get: () => ctx.query,
        enumerable: true,
        configurable: true,
      });
    }
    for (const [name, token] of c.services) input[name] = ctx.provider.get(token as Constructor);

    let result = await config.handle(input);
    if (config.response && !(result instanceof Response)) {
      const checked = await config.response['~standard'].validate(result);
      if (checked.issues) {
        throw new Error(
          `Response of ${c.info.name} does not match its schema: ${checked.issues.map((i) => i.message).join('; ')}`,
        );
      }
      result = checked.value;
    }
    return toResponse(result, ctx.request.method, config.status);
  }

  // --- errors ----------------------------------------------------------------

  function report(error: unknown, ctx: RequestContext): void {
    try {
      const log = logger();
      if (log) log.error(error, { method: ctx.method, path: pathnameOf(ctx.request.url) });
      else console.error(error);
    } catch {
      // A failing logger must not mask the 500.
    }
  }

  async function handleError(
    error: unknown,
    ctx: RequestContext,
    c: Compiled | undefined,
  ): Promise<Response> {
    const handlers = options.onError
      ? [...(c?.errorHandlers ?? []), options.onError]
      : (c?.errorHandlers ?? []);
    for (const handler of handlers) {
      try {
        const res = await handler(error, ctx);
        if (res instanceof Response) return res;
      } catch (inner) {
        report(inner, ctx);
        return new InternalServerErrorException().toResponse();
      }
    }
    if (error instanceof HttpException) return error.toResponse();
    report(error, ctx);
    return new InternalServerErrorException().toResponse();
  }

  function unmatched(request: Request, pathname: string): HttpException {
    const allowed = router.allowedMethods(pathname);
    const message = `Cannot ${request.method} ${pathname}`;
    return allowed.length
      ? new MethodNotAllowedException(message, { headers: { allow: allowed.join(', ') } })
      : new NotFoundException(message);
  }

  const handle: FetchHandler = async (request, info) => {
    const pathname = pathnameOf(request.url);
    const match = router.match(request.method, pathname);
    const compiled = match?.handler;
    const scope = provider.createScope();
    const ctx = new RequestContext(
      request,
      match?.params ?? EMPTY_PARAMS,
      scope,
      compiled?.info,
      settings,
      info?.remoteAddress,
    );
    contexts.set(scope, ctx);
    try {
      const middlewares = compiled?.middlewares.length
        ? globalMiddlewares.length
          ? [...globalMiddlewares, ...compiled.middlewares]
          : compiled.middlewares
        : globalMiddlewares;
      // Errors are rendered inside the middleware chain, so `next()` always yields a Response
      // and middlewares can decorate 404s and error responses (CORS headers, request ids, ...).
      const final = async () => {
        try {
          if (!compiled) throw unmatched(request, pathname);
          return await invoke(compiled, ctx);
        } catch (error) {
          return await handleError(error, ctx, compiled);
        }
      };
      const response = middlewares.length
        ? await runMiddlewares(middlewares, ctx, final, (error) =>
            handleError(error, ctx, compiled),
          )
        : await final();
      return ctx.finalize(response);
    } catch (error) {
      // Thrown by a middleware itself.
      return ctx.finalize(await handleError(error, ctx, compiled));
    } finally {
      try {
        await scope.dispose();
      } catch (error) {
        report(error, ctx);
      }
    }
  };

  return { handle, routes: table, middlewares: globalMiddlewares };
}
