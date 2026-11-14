import { defineMetadata, getOwnMetadata } from './metadata.js';
import type { Lifetime, Token } from './types.js';

export const SERVICE_KEY = 'suku:service';
export const INJECT_KEY = 'suku:inject';
export const OPTIONAL_KEY = 'suku:optional';

export interface ServiceOptions {
  /** Default lifetime used when the class is registered bare (`collection.add(MyService)`). */
  lifetime?: Lifetime;
}

export interface InjectOptions {
  token: Token;
  key?: unknown;
}

/**
 * Marks a class as resolvable by the container. Any decorator makes TypeScript emit
 * `design:paramtypes`, which is what the container reads to perform constructor
 * injection; this one additionally records default registration options.
 */
export function Service(options: ServiceOptions = {}): ClassDecorator {
  return (target) => {
    defineMetadata(SERVICE_KEY, options, target);
  };
}

export function getServiceOptions(target: object): ServiceOptions | undefined {
  return getOwnMetadata<ServiceOptions>(SERVICE_KEY, target);
}

export function isService(target: object): boolean {
  return getOwnMetadata(SERVICE_KEY, target) !== undefined;
}

/**
 * Overrides the token used for one constructor parameter. Required when the
 * parameter type is an interface, a primitive, a string/symbol token, or an
 * `InjectionToken`. Pass `key` to resolve a keyed registration.
 */
export function Inject(token: Token, key?: unknown): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const map =
      getOwnMetadata<Map<number, InjectOptions>>(INJECT_KEY, target) ??
      new Map<number, InjectOptions>();
    map.set(parameterIndex, key === undefined ? { token } : { token, key });
    defineMetadata(INJECT_KEY, map, target);
  };
}

/** Resolves to `undefined` instead of throwing when the parameter's service is missing. */
export function Optional(): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const set = getOwnMetadata<Set<number>>(OPTIONAL_KEY, target) ?? new Set<number>();
    set.add(parameterIndex);
    defineMetadata(OPTIONAL_KEY, set, target);
  };
}
