import { defineMetadata, getOwnMetadata, isConstructor } from '@suku/di';
import { getHandlerMetadata } from './controller.js';
import {
  type EnhancerKind,
  type Enhancers,
  emptyEnhancers,
  type FilterRef,
  type GuardRef,
  type InterceptorRef,
  type MiddlewareRef,
  type PipeRef,
} from './enhancers.js';

const CLASS_ENHANCERS_KEY = 'suku:class-enhancers';
const CATCH_KEY = 'suku:catch';

/** A decorator usable on a controller class or on a handler method. */
export type ClassOrMethodDecorator = (
  target: any,
  propertyKey?: string | symbol,
  descriptor?: PropertyDescriptor,
) => void;

function ownClassEnhancers(cls: object): Enhancers {
  let e = getOwnMetadata<Enhancers>(CLASS_ENHANCERS_KEY, cls);
  if (!e) {
    e = emptyEnhancers();
    defineMetadata(CLASS_ENHANCERS_KEY, e, cls);
  }
  return e;
}

/** Class-level enhancers, including those declared on parent classes (parents first). */
export function getClassEnhancers(cls: object): Enhancers {
  const chain: Enhancers[] = [];
  let current: object | null = cls;
  while (current && current !== Function.prototype) {
    const own = getOwnMetadata<Enhancers>(CLASS_ENHANCERS_KEY, current);
    if (own) chain.unshift(own);
    current = Object.getPrototypeOf(current);
  }
  const merged = emptyEnhancers();
  for (const e of chain) {
    merged.middleware.push(...e.middleware);
    merged.guards.push(...e.guards);
    merged.interceptors.push(...e.interceptors);
    merged.pipes.push(...e.pipes);
    merged.filters.push(...e.filters);
    for (const [k, v] of e.metadata) merged.metadata.set(k, v);
  }
  return merged;
}

function enhance(kind: EnhancerKind, refs: unknown[]): ClassOrMethodDecorator {
  return (target, propertyKey) => {
    const bucket =
      propertyKey === undefined
        ? ownClassEnhancers(target)
        : getHandlerMetadata(target.constructor, propertyKey, true).enhancers;
    (bucket[kind] as unknown[]).push(...refs);
  };
}

/** Middleware for one controller or handler. Runs after global and module middleware. */
export const UseMiddleware = (...middleware: MiddlewareRef[]): ClassOrMethodDecorator =>
  enhance('middleware', middleware);
export const UseGuards = (...guards: GuardRef[]): ClassOrMethodDecorator =>
  enhance('guards', guards);
export const UseInterceptors = (...interceptors: InterceptorRef[]): ClassOrMethodDecorator =>
  enhance('interceptors', interceptors);
export const UsePipes = (...pipes: PipeRef[]): ClassOrMethodDecorator => enhance('pipes', pipes);
export const UseFilters = (...filters: FilterRef[]): ClassOrMethodDecorator =>
  enhance('filters', filters);

/**
 * Attaches a value to a controller or handler for guards and interceptors to read with
 * `ctx.getMetadata(key)`. Method values override class values.
 *
 * ```ts
 * const Roles = (...roles: string[]) => SetMetadata('roles', roles);
 * ```
 */
export function SetMetadata<K, V>(key: K, value: V): ClassOrMethodDecorator {
  return (target, propertyKey) => {
    const bucket =
      propertyKey === undefined
        ? ownClassEnhancers(target)
        : getHandlerMetadata(target.constructor, propertyKey, true).enhancers;
    bucket.metadata.set(key, value);
  };
}

/** Restricts an exception filter class to the given error types (checked with `instanceof`). */
export function Catch(...types: Function[]): ClassDecorator {
  return (target) => {
    defineMetadata(CATCH_KEY, types, target);
  };
}

/** Error types a filter handles: from `@Catch` on its class, or a `catches` property on an instance. */
export function getCatchTypes(filter: unknown): Function[] | undefined {
  if (isConstructor(filter)) return getOwnMetadata<Function[]>(CATCH_KEY, filter);
  if (filter !== null && typeof filter === 'object') {
    const own = (filter as { catches?: Function[] }).catches;
    if (own) return own;
    return getOwnMetadata<Function[]>(CATCH_KEY, filter.constructor);
  }
  return undefined;
}
