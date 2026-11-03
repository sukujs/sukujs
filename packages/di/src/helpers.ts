import { describe, type ServiceDescriptor } from './descriptor.js';
import type { Constructor, Factory, Lifetime, Token } from './types.js';

export interface BindingOptions {
  /** Registers a keyed service, resolved with `getKeyed(token, key)` or `@Inject(token, key)`. */
  key?: unknown;
}

/**
 * Typed registration helpers. Unlike `{ provide, useClass }` objects, the implementation is
 * checked against the token: `singleton(Logger, ConsoleLogger)` fails to compile unless
 * `ConsoleLogger` is assignable to `Logger`.
 *
 * ```ts
 * services: [
 *   singleton(Logger, ConsoleLogger),
 *   scoped(UnitOfWork),
 *   value(CONFIG, { port: 3000 }),
 *   factory(Mailer, (sp) => new Mailer(sp.get(Logger))),
 *   alias(Cache, RedisCache),
 * ]
 * ```
 */
export function singleton<T>(
  token: Token<T>,
  impl?: Constructor<NoInfer<T>>,
  options?: BindingOptions,
): ServiceDescriptor<T> {
  return describe(token, impl, 'singleton', options?.key);
}

export function scoped<T>(
  token: Token<T>,
  impl?: Constructor<NoInfer<T>>,
  options?: BindingOptions,
): ServiceDescriptor<T> {
  return describe(token, impl, 'scoped', options?.key);
}

export function transient<T>(
  token: Token<T>,
  impl?: Constructor<NoInfer<T>>,
  options?: BindingOptions,
): ServiceDescriptor<T> {
  return describe(token, impl, 'transient', options?.key);
}

/** Registers an existing instance or constant. Never disposed by the container. */
export function value<T>(
  token: Token<T>,
  instance: T,
  options?: BindingOptions,
): ServiceDescriptor<T> {
  return describe(token, { useValue: instance }, 'singleton', options?.key);
}

/** Registers a factory. Singleton unless a lifetime is given. */
export function factory<T>(
  token: Token<T>,
  create: Factory<NoInfer<T>>,
  lifetime: Lifetime = 'singleton',
  options?: BindingOptions,
): ServiceDescriptor<T> {
  return describe(token, { useFactory: create }, lifetime, options?.key);
}

/** Makes `token` resolve to whatever `existing` resolves to. */
export function alias<T, U extends T>(
  token: Token<T>,
  existing: Token<U>,
  options?: BindingOptions,
): ServiceDescriptor<T> {
  return describe(token, { useExisting: existing as Token<T> }, 'singleton', options?.key);
}
