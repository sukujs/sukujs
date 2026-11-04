import { defineMetadata, getMetadata, getOwnMetadata, type Lifetime } from '@suku/di';
import { type Enhancers, emptyEnhancers } from './enhancers.js';
import { CONTROLLER_KEY, HANDLERS_KEY } from './keys.js';

export interface ControllerOptions {
  /** Route prefix for every handler in the class, e.g. `'users'` or `'/api/users'`. */
  path?: string;
  /**
   * `singleton` (default): one instance for the app's lifetime, like NestJS.
   * `scoped`: a fresh instance per request, like .NET controllers.
   */
  lifetime?: Lifetime;
}

export interface ControllerMetadata {
  path: string;
  lifetime: Lifetime;
}

export function Controller(pathOrOptions: string | ControllerOptions = ''): ClassDecorator {
  const options = typeof pathOrOptions === 'string' ? { path: pathOrOptions } : pathOrOptions;
  return (target) => {
    defineMetadata(
      CONTROLLER_KEY,
      {
        path: options.path ?? '',
        lifetime: options.lifetime ?? 'singleton',
      } satisfies ControllerMetadata,
      target,
    );
  };
}

export function getControllerMetadata(target: object): ControllerMetadata | undefined {
  return getOwnMetadata<ControllerMetadata>(CONTROLLER_KEY, target);
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ALL';

export interface RouteMetadata {
  method: HttpMethod;
  path: string;
}

/** Everything the decorators on one handler method recorded. */
export interface HandlerMetadata {
  name: string | symbol;
  routes: RouteMetadata[];
  httpCode?: number;
  headers: [string, string][];
  redirect?: { url: string; status: number };
  /** Method-level `@UseGuards`, `@UsePipes`, ..., and `@SetMetadata` values. */
  enhancers: Enhancers;
}

/**
 * Handler metadata is keyed by method name and stored on the class so that method
 * decorators can run in any order (TypeScript applies them bottom-up).
 */
export function getHandlerMetadata(
  target: object,
  name: string | symbol,
  create: true,
): HandlerMetadata;
export function getHandlerMetadata(
  target: object,
  name: string | symbol,
  create?: false,
): HandlerMetadata | undefined;
export function getHandlerMetadata(
  target: object,
  name: string | symbol,
  create = false,
): HandlerMetadata | undefined {
  let map = getOwnMetadata<Map<string | symbol, HandlerMetadata>>(HANDLERS_KEY, target);
  if (!map) {
    if (!create) return undefined;
    map = new Map();
    defineMetadata(HANDLERS_KEY, map, target);
  }
  let meta = map.get(name);
  if (!meta && create) {
    meta = { name, routes: [], headers: [], enhancers: emptyEnhancers() };
    map.set(name, meta);
  }
  return meta;
}

/** All handlers declared on a controller class and its ancestors. */
export function getAllHandlers(target: object): HandlerMetadata[] {
  const seen = new Map<string | symbol, HandlerMetadata>();
  let current: object | null = target;
  while (current && current !== Function.prototype) {
    const map = getOwnMetadata<Map<string | symbol, HandlerMetadata>>(HANDLERS_KEY, current);
    if (map) for (const [k, v] of map) if (!seen.has(k)) seen.set(k, v);
    current = Object.getPrototypeOf(current);
  }
  return [...seen.values()];
}

function route(method: HttpMethod) {
  return (path = ''): MethodDecorator =>
    (target, propertyKey) => {
      getHandlerMetadata(target.constructor, propertyKey, true).routes.push({ method, path });
    };
}

export const Get = route('GET');
export const Post = route('POST');
export const Put = route('PUT');
export const Patch = route('PATCH');
export const Delete = route('DELETE');
export const Head = route('HEAD');
export const Options = route('OPTIONS');
export const All = route('ALL');

/** Overrides the default status (200, or 201 for POST). */
export function HttpCode(status: number): MethodDecorator {
  return (target, propertyKey) => {
    getHandlerMetadata(target.constructor, propertyKey, true).httpCode = status;
  };
}

/** Adds a response header to every response from the handler. */
export function Header(name: string, value: string): MethodDecorator {
  return (target, propertyKey) => {
    getHandlerMetadata(target.constructor, propertyKey, true).headers.push([name, value]);
  };
}

/**
 * Redirects instead of rendering the return value. A handler may return
 * `{ url, status? }` to override the decorator's values per request.
 */
export function Redirect(url: string, status = 302): MethodDecorator {
  return (target, propertyKey) => {
    getHandlerMetadata(target.constructor, propertyKey, true).redirect = { url, status };
  };
}

// Re-exported so `getMetadata` users can walk inherited metadata without importing di.
export { getMetadata };
