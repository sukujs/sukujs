/**
 * Minimal replacement for the `reflect-metadata` package.
 *
 * TypeScript's `emitDecoratorMetadata` emits calls such as
 * `__metadata("design:paramtypes", [Logger, Database])`, which forward to
 * `Reflect.metadata(key, value)` when that function exists. This module installs
 * just enough of the Reflect metadata API, backed by a WeakMap, so the container can
 * read constructor parameter types without a dependency.
 *
 * It is installed once on `globalThis.Reflect` the first time `@sukujs/di` is imported,
 * and never overrides an existing implementation (for example a user-installed
 * `reflect-metadata`).
 */

export type MetadataKey = string | symbol;
type PropertyKey = string | symbol | undefined;

type TargetStore = Map<PropertyKey, Map<MetadataKey, unknown>>;
const store = new WeakMap<object, TargetStore>();

function getTargetMap(target: object, property: PropertyKey, create: boolean) {
  let perTarget = store.get(target);
  if (!perTarget) {
    if (!create) return undefined;
    perTarget = new Map();
    store.set(target, perTarget);
  }
  let perProperty = perTarget.get(property);
  if (!perProperty && create) {
    perProperty = new Map();
    perTarget.set(property, perProperty);
  }
  return perProperty;
}

export function defineMetadata(
  key: MetadataKey,
  value: unknown,
  target: object,
  property?: PropertyKey,
): void {
  getTargetMap(target, property, true)!.set(key, value);
}

export function getOwnMetadata<T = unknown>(
  key: MetadataKey,
  target: object,
  property?: PropertyKey,
): T | undefined {
  return getTargetMap(target, property, false)?.get(key) as T | undefined;
}

export function hasOwnMetadata(key: MetadataKey, target: object, property?: PropertyKey): boolean {
  return getTargetMap(target, property, false)?.has(key) ?? false;
}

/** Looks up metadata on the target and then along its prototype chain. */
export function getMetadata<T = unknown>(
  key: MetadataKey,
  target: object,
  property?: PropertyKey,
): T | undefined {
  let current: object | null = target;
  while (current) {
    const map = getTargetMap(current, property, false);
    if (map?.has(key)) return map.get(key) as T;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

export function hasMetadata(key: MetadataKey, target: object, property?: PropertyKey): boolean {
  return getMetadata(key, target, property) !== undefined;
}

export function getOwnMetadataKeys(target: object, property?: PropertyKey): MetadataKey[] {
  return [...(getTargetMap(target, property, false)?.keys() ?? [])];
}

export function getMetadataKeys(target: object, property?: PropertyKey): MetadataKey[] {
  const keys = new Set<MetadataKey>();
  let current: object | null = target;
  while (current) {
    for (const key of getOwnMetadataKeys(current, property)) keys.add(key);
    current = Object.getPrototypeOf(current);
  }
  return [...keys];
}

export function deleteMetadata(key: MetadataKey, target: object, property?: PropertyKey): boolean {
  return getTargetMap(target, property, false)?.delete(key) ?? false;
}

/** Decorator factory form, matching `Reflect.metadata` from reflect-metadata. */
export function metadata(key: MetadataKey, value: unknown) {
  return (target: object, property?: PropertyKey): void => {
    defineMetadata(key, value, target, property);
  };
}

type ReflectWithMetadata = typeof Reflect & {
  metadata?: typeof metadata;
  defineMetadata?: typeof defineMetadata;
  getMetadata?: typeof getMetadata;
  getOwnMetadata?: typeof getOwnMetadata;
  hasMetadata?: typeof hasMetadata;
  hasOwnMetadata?: typeof hasOwnMetadata;
  getMetadataKeys?: typeof getMetadataKeys;
  getOwnMetadataKeys?: typeof getOwnMetadataKeys;
  deleteMetadata?: typeof deleteMetadata;
};

/** Installs the shim on `globalThis.Reflect` unless a metadata API is already present. */
export function installReflectShim(): boolean {
  const R = globalThis.Reflect as ReflectWithMetadata;
  if (typeof R.metadata === 'function') return false;
  R.metadata = metadata;
  R.defineMetadata = defineMetadata;
  R.getMetadata = getMetadata;
  R.getOwnMetadata = getOwnMetadata;
  R.hasMetadata = hasMetadata;
  R.hasOwnMetadata = hasOwnMetadata;
  // The full surface, so `reflect-metadata` can adopt this store if it is loaded later.
  R.getMetadataKeys = getMetadataKeys;
  R.getOwnMetadataKeys = getOwnMetadataKeys;
  R.deleteMetadata = deleteMetadata;
  return true;
}

installReflectShim();

/**
 * Read metadata through whatever Reflect implementation is active, so that the
 * container still works when the user installed `reflect-metadata` before us.
 */
export function readMetadata<T = unknown>(key: MetadataKey, target: object): T | undefined {
  const R = globalThis.Reflect as ReflectWithMetadata;
  if (R.getMetadata && R.getMetadata !== getMetadata) {
    // Another implementation (reflect-metadata) is installed. Classes decorated before it
    // loaded recorded their metadata in our own store, so fall back to that.
    return (R.getMetadata(key, target) as T | undefined) ?? getMetadata<T>(key, target);
  }
  return getMetadata<T>(key, target);
}

export function readOwnMetadata<T = unknown>(key: MetadataKey, target: object): T | undefined {
  const R = globalThis.Reflect as ReflectWithMetadata;
  if (R.getOwnMetadata && R.getOwnMetadata !== getOwnMetadata) {
    return (R.getOwnMetadata(key, target) as T | undefined) ?? getOwnMetadata<T>(key, target);
  }
  return getOwnMetadata<T>(key, target);
}

export const DESIGN_PARAMTYPES = 'design:paramtypes';
