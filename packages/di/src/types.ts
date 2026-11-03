import type { ServiceProvider } from './provider.js';

export type Constructor<T = unknown> = new (...args: any[]) => T;
export type AbstractConstructor<T = unknown> = abstract new (...args: any[]) => T;

/**
 * Opaque token for registering values that have no class to stand in for them
 * (configuration objects, primitives, interfaces). Carries its type parameter so
 * `provider.get(TOKEN)` is typed.
 */
export class InjectionToken<T = unknown> {
  declare readonly __type?: T;
  constructor(public readonly description: string) {}
  toString(): string {
    return `InjectionToken(${this.description})`;
  }
}

export type Token<T = unknown> =
  | Constructor<T>
  | AbstractConstructor<T>
  | InjectionToken<T>
  | string
  | symbol;

/** Infers the service type a token resolves to. */
export type Resolved<K> = K extends Token<infer T> ? T : never;

export type Lifetime = 'singleton' | 'scoped' | 'transient';

export type Factory<T = unknown> = (provider: ServiceProvider) => T;

export function isConstructor(value: unknown): value is Constructor {
  if (typeof value !== 'function') return false;
  // Classes have a non-writable `prototype`; plain functions have a writable one and
  // arrow functions have none. This is how we tell a class from a factory function.
  const desc = Object.getOwnPropertyDescriptor(value, 'prototype');
  return desc !== undefined && desc.writable === false;
}

export function isToken(value: unknown): value is Token {
  return (
    typeof value === 'function' ||
    typeof value === 'string' ||
    typeof value === 'symbol' ||
    value instanceof InjectionToken
  );
}

export function tokenName(token: unknown): string {
  if (typeof token === 'function') return token.name || '<anonymous class>';
  if (token instanceof InjectionToken) return token.toString();
  if (typeof token === 'symbol') return token.toString();
  if (typeof token === 'string') return JSON.stringify(token);
  return String(token);
}
