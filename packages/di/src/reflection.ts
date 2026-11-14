import { INJECT_KEY, type InjectOptions, OPTIONAL_KEY } from './decorators.js';
import { UnresolvableParameterError } from './errors.js';
import { DESIGN_PARAMTYPES, hasOwnMetadata, readMetadata, readOwnMetadata } from './metadata.js';
import type { Token } from './types.js';

export interface InjectEntryObject {
  token: Token;
  key?: unknown;
  optional?: boolean;
}
/** One entry of a class's `static inject` array. */
export type InjectEntry = Token | InjectEntryObject;

function isEntryObject(value: unknown): value is InjectEntryObject {
  return typeof value === 'object' && value !== null && 'token' in value;
}

export interface ParameterInfo {
  readonly index: number;
  readonly token: Token;
  readonly key?: unknown;
  readonly optional: boolean;
}

const cache = new WeakMap<Function, readonly ParameterInfo[]>();

/** Types TypeScript emits for parameters it cannot represent at runtime. */
const UNUSABLE = new Set<unknown>([
  undefined,
  null,
  Object,
  Function,
  String,
  Number,
  Boolean,
  Symbol,
  Array,
  Promise,
]);

function maxIndex(iter: Iterable<number> | undefined): number {
  let max = -1;
  if (iter) for (const i of iter) if (i > max) max = i;
  return max;
}

/**
 * Determines the token for each constructor parameter of `cls`, combining
 * `design:paramtypes` (emitted by TypeScript) with `@Inject` / `@Optional` overrides.
 * Results are cached per class.
 */
export function getConstructorParameters(cls: Function): readonly ParameterInfo[] {
  const cached = cache.get(cls);
  if (cached) return cached;

  // Decorator-free form: `static inject = [Database, { token: CONFIG, optional: true }]`.
  const explicit = (cls as { inject?: unknown }).inject;
  if (Array.isArray(explicit) && Object.hasOwn(cls, 'inject')) {
    const params = (explicit as InjectEntry[]).map((entry, index): ParameterInfo => {
      const e =
        isTokenLike(entry) && !isEntryObject(entry)
          ? { token: entry as Token }
          : (entry as InjectEntryObject);
      if (!isTokenLike(e.token)) {
        throw new UnresolvableParameterError(cls, index, 'static inject entry is not a token.');
      }
      const info: ParameterInfo = { index, token: e.token, optional: e.optional ?? false };
      return e.key === undefined ? info : { ...info, key: e.key };
    });
    cache.set(cls, params);
    return params;
  }

  // If the class declares its own constructor metadata, ignore inherited @Inject /
  // @Optional markers, which were written for the parent's parameters.
  const own = hasOwnMetadata(DESIGN_PARAMTYPES, cls);
  const read = own ? readOwnMetadata : readMetadata;

  const types = readMetadata<unknown[]>(DESIGN_PARAMTYPES, cls);
  const injects = read<Map<number, InjectOptions>>(INJECT_KEY, cls);
  const optionals = read<Set<number>>(OPTIONAL_KEY, cls);

  const count = Math.max(
    types?.length ?? 0,
    maxIndex(injects?.keys()) + 1,
    maxIndex(optionals) + 1,
  );

  if (count === 0 && cls.length > 0) {
    throw new UnresolvableParameterError(
      cls,
      -1,
      `it declares ${cls.length} constructor parameter(s) but no type metadata was emitted. ` +
        'Decorate the class with @Injectable() and compile with "emitDecoratorMetadata": true, ' +
        'or annotate each parameter with @Inject(token).',
    );
  }

  const params: ParameterInfo[] = [];
  for (let i = 0; i < count; i++) {
    const override = injects?.get(i);
    const token = override?.token ?? types?.[i];
    if (UNUSABLE.has(token) || !isTokenLike(token)) {
      throw new UnresolvableParameterError(
        cls,
        i,
        token === undefined && types !== undefined
          ? 'its type is undefined at runtime (usually a circular import or a type-only import). ' +
              'Use @Inject(token) with an explicit token.'
          : `its type (${describeType(token)}) is an interface, primitive, or union that does not exist at runtime. ` +
              'Use @Inject(token) with a class, InjectionToken, string, or symbol.',
      );
    }
    const info: ParameterInfo = {
      index: i,
      token,
      optional: optionals?.has(i) ?? false,
    };
    params.push(override?.key === undefined ? info : { ...info, key: override.key });
  }

  cache.set(cls, params);
  return params;
}

function isTokenLike(value: unknown): value is Token {
  return (
    typeof value === 'function' ||
    typeof value === 'string' ||
    typeof value === 'symbol' ||
    (typeof value === 'object' && value !== null)
  );
}

function describeType(t: unknown): string {
  if (typeof t === 'function') return t.name || 'anonymous';
  return String(t);
}
