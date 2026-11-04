import {
  type Constructor,
  getMetadata,
  isConstructor,
  type ServiceCollection,
  type ServiceProvider,
} from '@suku/di';
import type { FetchHandler } from './adapter.js';
import { RequestContext, type RequestSettings, type RouteInfo } from './context.js';
import { getAllHandlers, getControllerMetadata, type HandlerMetadata } from './controller.js';
import {
  type Enhancers,
  type ExceptionFilter,
  emptyEnhancers,
  type FilterFn,
  type FilterRef,
  type Guard,
  type GuardFn,
  type GuardRef,
  type Interceptor,
  type InterceptorFn,
  type InterceptorRef,
  type Middleware,
  type MiddlewareFn,
  type MiddlewareRef,
  type Pipe,
  type PipeFn,
  type PipeRef,
} from './enhancers.js';
import {
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  MethodNotAllowedException,
  NotFoundException,
} from './http-errors.js';
import { Logger } from './logger.js';
import { getParamMetadata, type ParamMetadata } from './params.js';
import { getCatchTypes, getClassEnhancers } from './pipeline.js';
import { toResponse } from './response.js';
import { Router } from './router.js';
import type { ScanResult } from './scanner.js';
import { pathnameOf } from './url.js';

export interface KernelOptions {
  /** Prepended to every route, e.g. `'/api'`. */
  globalPrefix?: string;
  /** Called for errors that are not `HttpException`s before a 500 is sent. Default: the registered `Logger`. */
  onError?: (error: unknown, ctx: RequestContext | undefined) => void;
  /** Maximum request body size in bytes for `@Body()` / `ctx.body()`. Default 1 MiB. */
  bodyLimit?: number;
  /** Global pipeline pieces. Classes are registered as services automatically. */
  middleware?: MiddlewareRef[];
  guards?: GuardRef[];
  interceptors?: InterceptorRef[];
  pipes?: PipeRef[];
  filters?: FilterRef[];
}

interface CompiledRoute {
  readonly controller: Constructor;
  readonly handler: string | symbol;
  readonly meta: HandlerMetadata;
  readonly params: readonly ParamMetadata[];
  readonly paramTypes: readonly (Function | undefined)[] | undefined;
  readonly argCount: number;
  readonly info: RouteInfo;
  /** Module + class + method enhancers, in execution order (filters: most specific first). */
  readonly enhancers: Enhancers;
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
  controller: string;
  handler: string;
}

export interface Kernel {
  readonly handle: FetchHandler;
  /** For diagnostics and tests. */
  readonly routes: readonly RouteTableEntry[];
  /** Global pipeline pieces. Mutable so `app.useGlobalGuards()` and friends can add to it. */
  readonly globals: Enhancers;
}

const EMPTY_PARAMS: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Every class referenced by the pipeline (decorators, module middleware, global options),
 * so the application can register them before the container is built.
 */
export function collectEnhancerClasses(scan: ScanResult, options: KernelOptions): Constructor[] {
  const out = new Set<Constructor>();
  const take = (refs: readonly unknown[] | undefined) => {
    for (const r of refs ?? []) if (isConstructor(r)) out.add(r);
  };
  take(options.middleware);
  take(options.guards);
  take(options.interceptors);
  take(options.pipes);
  take(options.filters);
  for (const mws of scan.controllerMiddleware.values()) take(mws);
  for (const controller of scan.controllers) {
    const sets: Enhancers[] = [
      getClassEnhancers(controller),
      ...getAllHandlers(controller).map((h) => h.enhancers),
    ];
    for (const e of sets) {
      take(e.middleware);
      take(e.guards);
      take(e.interceptors);
      take(e.pipes);
      take(e.filters);
    }
    for (const h of getAllHandlers(controller))
      for (const p of getParamMetadata(controller, h.name)) take(p.pipes);
  }
  return [...out];
}

export function registerEnhancerClasses(
  collection: ServiceCollection,
  classes: Constructor[],
): void {
  for (const cls of classes) collection.tryAdd(cls);
}

function resolveRef<T, F>(ref: Constructor<T> | T | F, ctx: RequestContext): T | F {
  return isConstructor(ref) ? (ctx.provider.get(ref) as T) : (ref as T | F);
}

export function createKernel(
  scan: ScanResult,
  provider: ServiceProvider,
  options: KernelOptions = {},
): Kernel {
  const router = new Router<CompiledRoute>();
  const table: RouteTableEntry[] = [];
  const onError =
    options.onError ??
    ((error, ctx) => {
      const logger = provider.getOptional(Logger);
      if (logger)
        logger.error(
          error,
          ctx ? { method: ctx.method, path: pathnameOf(ctx.request.url) } : undefined,
        );
      else console.error(error);
    });
  const settings: RequestSettings = {
    body: options.bodyLimit === undefined ? {} : { limit: options.bodyLimit },
  };
  const globals: Enhancers = {
    middleware: [...(options.middleware ?? [])],
    guards: [...(options.guards ?? [])],
    interceptors: [...(options.interceptors ?? [])],
    pipes: [...(options.pipes ?? [])],
    filters: [...(options.filters ?? [])],
    metadata: new Map(),
  };

  for (const controller of scan.controllers) {
    const ctrl = getControllerMetadata(controller)!;
    const classEnhancers = getClassEnhancers(controller);
    const moduleMiddleware = scan.controllerMiddleware.get(controller) ?? [];
    for (const meta of getAllHandlers(controller)) {
      if (meta.routes.length === 0) continue;
      const params = [...getParamMetadata(controller, meta.name)].sort((a, b) => a.index - b.index);
      const fn = (controller.prototype as Record<string | symbol, unknown>)[meta.name];
      if (typeof fn !== 'function') {
        throw new TypeError(
          `${controller.name}.${String(meta.name)} is decorated as a route but is not a method.`,
        );
      }
      const paramTypes = getMetadata<(Function | undefined)[]>(
        'design:paramtypes',
        controller.prototype,
        meta.name,
      );
      const argCount = Math.max(
        fn.length,
        params.length ? params[params.length - 1]!.index + 1 : 0,
      );
      const m = meta.enhancers;
      const enhancers: Enhancers = {
        middleware: [...moduleMiddleware, ...classEnhancers.middleware, ...m.middleware],
        guards: [...classEnhancers.guards, ...m.guards],
        interceptors: [...classEnhancers.interceptors, ...m.interceptors],
        pipes: [...classEnhancers.pipes, ...m.pipes],
        filters: [...m.filters, ...classEnhancers.filters],
        metadata: new Map([...classEnhancers.metadata, ...m.metadata]),
      };
      for (const route of meta.routes) {
        const path = joinPaths(options.globalPrefix, ctrl.path, route.path);
        const compiled: CompiledRoute = {
          controller,
          handler: meta.name,
          meta,
          params,
          paramTypes,
          argCount,
          enhancers,
          info: { method: route.method, path, controller, handler: meta.name },
        };
        router.add(route.method, path, compiled);
        table.push({
          method: route.method,
          path,
          controller: controller.name,
          handler: String(meta.name),
        });
      }
    }
  }

  // --- stages ----------------------------------------------------------------

  function runMiddleware(
    list: readonly MiddlewareRef[],
    ctx: RequestContext,
    final: () => Promise<Response>,
  ) {
    let reached = -1;
    const next = (index: number): Promise<Response> => {
      if (index <= reached)
        return Promise.reject(new Error('next() called more than once in middleware'));
      reached = index;
      if (index === list.length) return final();
      const mw = resolveRef<Middleware, MiddlewareFn>(list[index]!, ctx);
      const step = () => next(index + 1);
      return Promise.resolve(typeof mw === 'function' ? mw(ctx, step) : mw.use(ctx, step));
    };
    return next(0);
  }

  async function runGuards(list: readonly GuardRef[], ctx: RequestContext): Promise<void> {
    for (const ref of list) {
      const guard = resolveRef<Guard, GuardFn>(ref, ctx);
      const ok = await (typeof guard === 'function' ? guard(ctx) : guard.canActivate(ctx));
      if (!ok) throw new ForbiddenException('Forbidden resource');
    }
  }

  function withInterceptors(
    list: readonly InterceptorRef[],
    ctx: RequestContext,
    invoke: () => Promise<unknown>,
  ) {
    let next = invoke;
    for (let i = list.length - 1; i >= 0; i--) {
      const ref = list[i]!;
      const inner = next;
      next = async () => {
        const it = resolveRef<Interceptor, InterceptorFn>(ref, ctx);
        return typeof it === 'function' ? it(ctx, inner) : it.intercept(ctx, inner);
      };
    }
    return next;
  }

  async function applyPipes(
    list: readonly PipeRef[],
    value: unknown,
    p: ParamMetadata,
    route: CompiledRoute,
    ctx: RequestContext,
  ): Promise<unknown> {
    const metadata = {
      kind: p.kind,
      data: p.data,
      index: p.index,
      type: route.paramTypes?.[p.index],
      ctx,
    };
    let v = value;
    for (const ref of list) {
      const pipe = resolveRef<Pipe, PipeFn>(ref, ctx);
      v = await (typeof pipe === 'function' ? pipe(v, metadata) : pipe.transform(v, metadata));
    }
    return v;
  }

  async function callHandler(route: CompiledRoute, ctx: RequestContext): Promise<unknown> {
    const instance = ctx.provider.get(route.controller) as Record<
      string | symbol,
      (...a: unknown[]) => unknown
    >;
    const args = new Array<unknown>(route.argCount);
    const shared =
      globals.pipes.length || route.enhancers.pipes.length
        ? [...globals.pipes, ...route.enhancers.pipes]
        : undefined;
    for (const p of route.params) {
      let v = p.resolve(ctx);
      if (v instanceof Promise) v = await v;
      if (shared || p.pipes.length) {
        const list = shared ? (p.pipes.length ? [...shared, ...p.pipes] : shared) : p.pipes;
        v = await applyPipes(list, v, p, route, ctx);
      }
      args[p.index] = v;
    }
    return instance[route.handler]!.apply(instance, args);
  }

  async function dispatch(route: CompiledRoute, ctx: RequestContext): Promise<Response> {
    if (globals.guards.length) await runGuards(globals.guards, ctx);
    if (route.enhancers.guards.length) await runGuards(route.enhancers.guards, ctx);
    let invoke = () => callHandler(route, ctx);
    if (route.enhancers.interceptors.length)
      invoke = withInterceptors(route.enhancers.interceptors, ctx, invoke);
    if (globals.interceptors.length) invoke = withInterceptors(globals.interceptors, ctx, invoke);
    const result = await invoke();
    return toResponse(result, ctx.request.method, route.meta);
  }

  function applies(ref: FilterRef, filter: ExceptionFilter | FilterFn, error: unknown): boolean {
    const types = getCatchTypes(isConstructor(ref) ? ref : filter);
    if (!types || types.length === 0) return true;
    return types.some((t) => error instanceof t);
  }

  async function handleError(
    error: unknown,
    ctx: RequestContext,
    route: CompiledRoute | undefined,
  ): Promise<Response> {
    const lists = route ? [route.enhancers.filters, globals.filters] : [globals.filters];
    for (const list of lists) {
      for (const ref of list) {
        try {
          const filter = resolveRef<ExceptionFilter, FilterFn>(ref, ctx);
          if (!applies(ref, filter, error)) continue;
          const res = await (typeof filter === 'function'
            ? filter(error, ctx)
            : filter.catch(error, ctx));
          if (res) return res;
        } catch (inner) {
          onError(inner, ctx);
          return new InternalServerErrorException().toResponse();
        }
      }
    }
    if (error instanceof HttpException) return error.toResponse();
    try {
      onError(error, ctx);
    } catch {
      // A failing error hook must not mask the 500.
    }
    return new InternalServerErrorException().toResponse();
  }

  function unmatched(request: Request, pathname: string): HttpException {
    const allowed = router.allowedMethods(pathname);
    const message = `Cannot ${request.method} ${pathname}`;
    return allowed.length
      ? new MethodNotAllowedException(message, { headers: { allow: allowed.join(', ') } })
      : new NotFoundException(message);
  }

  const handle: FetchHandler = async (request) => {
    const pathname = pathnameOf(request.url);
    const match = router.match(request.method, pathname);
    const route = match?.handler;
    const scope = provider.createScope();
    const ctx = new RequestContext(
      request,
      match?.params ?? EMPTY_PARAMS,
      scope,
      route?.info,
      route?.enhancers.metadata,
      settings,
    );
    contexts.set(scope, ctx);
    try {
      const middleware =
        route && route.enhancers.middleware.length
          ? [...globals.middleware, ...route.enhancers.middleware]
          : globals.middleware;
      // Errors are rendered inside the middleware chain, so `next()` always yields a Response
      // and middleware can decorate 404s and error responses (CORS headers, request ids, ...).
      const final = async () => {
        try {
          if (!route) throw unmatched(request, pathname);
          return await dispatch(route, ctx);
        } catch (error) {
          return await handleError(error, ctx, route);
        }
      };
      return middleware.length ? await runMiddleware(middleware, ctx, final) : await final();
    } catch (error) {
      // Thrown by middleware itself.
      return await handleError(error, ctx, route);
    } finally {
      try {
        await scope.dispose();
      } catch (error) {
        onError(error, ctx);
      }
    }
  };

  return { handle, routes: table, globals };
}

export { emptyEnhancers };
