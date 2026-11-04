import { defineMetadata, getOwnMetadata, isConstructor } from '@suku/di';
import type { RequestContext } from './context.js';
import type { PipeRef } from './enhancers.js';
import { PARAMS_KEY } from './keys.js';
import { isStandardSchema, type StandardSchema, ValidationPipe } from './schema.js';

export type ParamResolver = (ctx: RequestContext) => unknown | Promise<unknown>;

export interface ParamMetadata {
  index: number;
  /** For diagnostics; built-ins use `Param`, `Query`, `Body`, ... custom ones use their name. */
  kind: string;
  data: unknown;
  resolve: ParamResolver;
  /** Pipes given to the decorator, applied after global, controller and handler pipes. */
  pipes: PipeRef[];
}

export function getParamMetadata(target: object, name: string | symbol): ParamMetadata[] {
  return getOwnMetadata<Map<string | symbol, ParamMetadata[]>>(PARAMS_KEY, target)?.get(name) ?? [];
}

function record(target: object, name: string | symbol, meta: ParamMetadata): void {
  let map = getOwnMetadata<Map<string | symbol, ParamMetadata[]>>(PARAMS_KEY, target);
  if (!map) {
    map = new Map();
    defineMetadata(PARAMS_KEY, map, target);
  }
  const list = map.get(name) ?? [];
  list.push(meta);
  map.set(name, list);
}

/** A pipe class or an object with `transform`; function pipes must follow the data argument. */
function looksLikePipe(value: unknown): boolean {
  return (
    isConstructor(value) ||
    isStandardSchema(value) ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { transform?: unknown }).transform === 'function')
  );
}

/** Standard Schemas given where a pipe is expected are wrapped in a `ValidationPipe`. */
function toPipe(ref: unknown): PipeRef {
  return isStandardSchema(ref) ? new ValidationPipe(ref) : (ref as PipeRef);
}

/**
 * Builds a parameter decorator from a resolver. The resolver receives the decorator's data
 * argument (if any) and the request context. Pipes may follow the data argument, or stand
 * in for it: `@Param('id', ParseIntPipe)` or `@Param(ParseIntPipe)`.
 *
 * ```ts
 * const User = createParamDecorator('User', (_data, ctx) => ctx.get('user'));
 * ```
 */
export function createParamDecorator<D = unknown>(
  kind: string,
  resolve: (data: D | undefined, ctx: RequestContext) => unknown | Promise<unknown>,
): (
  dataOrPipe?: D | PipeRef | StandardSchema,
  ...pipes: (PipeRef | StandardSchema)[]
) => ParameterDecorator {
  return (dataOrPipe?: D | PipeRef | StandardSchema, ...rest: (PipeRef | StandardSchema)[]) => {
    let data: D | undefined;
    let pipes: PipeRef[];
    if (looksLikePipe(dataOrPipe)) {
      pipes = [dataOrPipe, ...rest].map(toPipe);
    } else {
      data = dataOrPipe as D | undefined;
      pipes = rest.map(toPipe);
    }
    return (target, propertyKey, index) => {
      if (propertyKey === undefined) {
        throw new TypeError(
          `@${kind}() can only decorate handler method parameters, not constructor parameters.`,
        );
      }
      record(target.constructor, propertyKey, {
        index,
        kind,
        data,
        pipes,
        resolve: (ctx) => resolve(data, ctx),
      });
    };
  };
}

/** A route parameter (`@Param('id')`) or all of them as an object (`@Param()`). */
export const Param = createParamDecorator<string>('Param', (name, ctx) =>
  name === undefined ? ctx.params : ctx.params[name],
);

/** A query-string value (`@Query('page')`) or all of them as an object (`@Query()`). */
export const Query = createParamDecorator<string>('Query', (name, ctx) => {
  const sp = ctx.url.searchParams;
  if (name !== undefined) return sp.get(name) ?? undefined;
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of sp) {
    const existing = out[k];
    if (existing === undefined) out[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else out[k] = [existing, v];
  }
  return out;
});

/** A request header (`@Headers('authorization')`) or the `Headers` object (`@Headers()`). */
export const Headers = createParamDecorator<string>('Headers', (name, ctx) =>
  name === undefined ? ctx.request.headers : (ctx.request.headers.get(name) ?? undefined),
);

/** The Fetch `Request`. */
export const Req = createParamDecorator('Req', (_d, ctx) => ctx.request);

/** The `RequestContext`. */
export const Ctx = createParamDecorator('Ctx', (_d, ctx) => ctx);
