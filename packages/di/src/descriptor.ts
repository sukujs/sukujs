import { getInjectableOptions } from './decorators.js';
import { InvalidDescriptorError } from './errors.js';
import {
  type Constructor,
  type Factory,
  isConstructor,
  isToken,
  type Lifetime,
  type Token,
  tokenName,
} from './types.js';

export type DescriptorKind = 'class' | 'factory' | 'value' | 'existing';

/** A single registration. Immutable once added to a collection. */
export interface ServiceDescriptor<T = unknown> {
  readonly kind: DescriptorKind;
  readonly token: Token<T>;
  readonly lifetime: Lifetime;
  /** Present only for keyed registrations. */
  readonly key?: unknown;
  readonly useClass?: Constructor<T>;
  readonly useFactory?: Factory<T>;
  readonly useValue?: T;
  readonly useExisting?: Token<T>;
}

/** Second argument of `addSingleton(token, impl)` and friends. */
export type Implementation<T> =
  | Constructor<T>
  | Factory<T>
  | { useClass: Constructor<T> }
  | { useFactory: Factory<T> }
  | { useValue: T }
  | { useExisting: Token<T> };

interface ProviderBase<T> {
  provide: Token<T>;
  lifetime?: Lifetime;
  key?: unknown;
}
export interface ClassProvider<T = unknown> extends ProviderBase<T> {
  useClass: Constructor<T>;
}
export interface FactoryProvider<T = unknown> extends ProviderBase<T> {
  useFactory: Factory<T>;
}
export interface ValueProvider<T = unknown> extends ProviderBase<T> {
  useValue: T;
}
export interface ExistingProvider<T = unknown> extends ProviderBase<T> {
  useExisting: Token<T>;
}

/**
 * NestJS-style provider shorthand accepted by `collection.add()` and module
 * definitions: a bare class, or an object with `provide` and one `use*` field.
 */
export type Provider<T = unknown> =
  | Constructor<T>
  | ClassProvider<T>
  | FactoryProvider<T>
  | ValueProvider<T>
  | ExistingProvider<T>;

const USE_KEYS = ['useClass', 'useFactory', 'useValue', 'useExisting'] as const;

function withKey<T>(d: ServiceDescriptor<T>, key: unknown): ServiceDescriptor<T> {
  return key === undefined ? d : { ...d, key };
}

/** Builds a descriptor from `(token, implementation, lifetime)` as the add* methods receive it. */
export function describe<T>(
  token: Token<T>,
  impl: Implementation<T> | undefined,
  lifetime: Lifetime,
  key?: unknown,
): ServiceDescriptor<T> {
  if (!isToken(token)) {
    throw new InvalidDescriptorError(`Invalid token: ${String(token)}`);
  }
  if (impl === undefined) {
    if (!isConstructor(token)) {
      throw new InvalidDescriptorError(
        `${tokenName(token)} is not a class; supply an implementation (class, factory, or { useValue }).`,
      );
    }
    return withKey({ kind: 'class', token, lifetime, useClass: token as Constructor<T> }, key);
  }
  if (isConstructor(impl)) {
    return withKey({ kind: 'class', token, lifetime, useClass: impl as Constructor<T> }, key);
  }
  if (typeof impl === 'function') {
    return withKey({ kind: 'factory', token, lifetime, useFactory: impl as Factory<T> }, key);
  }
  if (impl !== null && typeof impl === 'object') {
    const present = USE_KEYS.filter((k) => k in impl);
    if (present.length !== 1) {
      throw new InvalidDescriptorError(
        `Implementation for ${tokenName(token)} must have exactly one of ${USE_KEYS.join(', ')}.`,
      );
    }
    if ('useClass' in impl) {
      if (!isConstructor(impl.useClass)) {
        throw new InvalidDescriptorError(`useClass for ${tokenName(token)} is not a class.`);
      }
      return withKey({ kind: 'class', token, lifetime, useClass: impl.useClass }, key);
    }
    if ('useFactory' in impl) {
      if (typeof impl.useFactory !== 'function') {
        throw new InvalidDescriptorError(`useFactory for ${tokenName(token)} is not a function.`);
      }
      return withKey({ kind: 'factory', token, lifetime, useFactory: impl.useFactory }, key);
    }
    if ('useValue' in impl) {
      return withKey({ kind: 'value', token, lifetime: 'singleton', useValue: impl.useValue }, key);
    }
    if (!isToken(impl.useExisting)) {
      throw new InvalidDescriptorError(`useExisting for ${tokenName(token)} is not a token.`);
    }
    return withKey({ kind: 'existing', token, lifetime, useExisting: impl.useExisting }, key);
  }
  throw new InvalidDescriptorError(`Invalid implementation for ${tokenName(token)}.`);
}

/** Converts NestJS-style provider shorthand into a descriptor. Bare classes default to singleton. */
export function normalizeProvider<T>(provider: Provider<T>): ServiceDescriptor<T> {
  if (isConstructor(provider)) {
    const lifetime = getInjectableOptions(provider)?.lifetime ?? 'singleton';
    return describe<T>(provider as Constructor<T>, undefined, lifetime);
  }
  if (provider === null || typeof provider !== 'object' || !('provide' in provider)) {
    throw new InvalidDescriptorError(
      'Provider must be a class or an object with a `provide` field and one of ' +
        `${USE_KEYS.join(', ')}.`,
    );
  }
  const { provide, lifetime, key, ...rest } = provider as unknown as ProviderBase<T> &
    Record<string, unknown>;
  const impl = Object.fromEntries(
    Object.entries(rest).filter(([k]) => (USE_KEYS as readonly string[]).includes(k)),
  ) as Implementation<T>;
  const effective: Lifetime =
    lifetime ??
    ('useClass' in impl ? getInjectableOptions(impl.useClass)?.lifetime : undefined) ??
    'singleton';
  return describe(provide, impl, effective, key);
}

export function isServiceDescriptor(value: unknown): value is ServiceDescriptor {
  return (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    'token' in value &&
    'lifetime' in value &&
    !('provide' in value)
  );
}
