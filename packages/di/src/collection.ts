import {
  describe,
  type Implementation,
  isServiceDescriptor,
  normalizeProvider,
  type Provider,
  type ServiceDescriptor,
} from './descriptor.js';
import {
  buildServiceProvider,
  type ServiceProvider,
  type ServiceProviderOptions,
} from './provider.js';
import type { Token } from './types.js';

/**
 * Ordered list of registrations, modelled on .NET's `IServiceCollection`.
 *
 * - `get(token)` resolves the **last** registration for a token.
 * - `getAll(token)` resolves every registration, in order.
 * - `tryAdd*` only registers when the token has no registration yet.
 */
export class ServiceCollection {
  private readonly items: ServiceDescriptor[] = [];

  get descriptors(): readonly ServiceDescriptor[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  /** Adds a descriptor, or a NestJS-style provider (`Class` or `{ provide, use* }`). */
  add(entry: ServiceDescriptor | Provider): this {
    this.items.push(isServiceDescriptor(entry) ? entry : normalizeProvider(entry));
    return this;
  }

  addRange(entries: Iterable<ServiceDescriptor | Provider>): this {
    for (const e of entries) this.add(e);
    return this;
  }

  addSingleton<T>(token: Token<T>, impl?: Implementation<T>): this {
    return this.add(describe(token, impl, 'singleton'));
  }

  addScoped<T>(token: Token<T>, impl?: Implementation<T>): this {
    return this.add(describe(token, impl, 'scoped'));
  }

  addTransient<T>(token: Token<T>, impl?: Implementation<T>): this {
    return this.add(describe(token, impl, 'transient'));
  }

  addKeyedSingleton<T>(token: Token<T>, key: unknown, impl?: Implementation<T>): this {
    return this.add(describe(token, impl, 'singleton', key));
  }

  addKeyedScoped<T>(token: Token<T>, key: unknown, impl?: Implementation<T>): this {
    return this.add(describe(token, impl, 'scoped', key));
  }

  addKeyedTransient<T>(token: Token<T>, key: unknown, impl?: Implementation<T>): this {
    return this.add(describe(token, impl, 'transient', key));
  }

  /** Adds only if nothing is registered for the token (and key). */
  tryAdd(entry: ServiceDescriptor | Provider): this {
    const d = isServiceDescriptor(entry) ? entry : normalizeProvider(entry);
    if (!this.has(d.token, d.key)) this.items.push(d);
    return this;
  }

  tryAddSingleton<T>(token: Token<T>, impl?: Implementation<T>): this {
    return this.tryAdd(describe(token, impl, 'singleton'));
  }

  tryAddScoped<T>(token: Token<T>, impl?: Implementation<T>): this {
    return this.tryAdd(describe(token, impl, 'scoped'));
  }

  tryAddTransient<T>(token: Token<T>, impl?: Implementation<T>): this {
    return this.tryAdd(describe(token, impl, 'transient'));
  }

  /**
   * Adds only if no registration for the token has the same implementation
   * (class, factory, or alias). Useful for plugin collections resolved with `getAll`.
   */
  tryAddEnumerable(entry: ServiceDescriptor | Provider): this {
    const d = isServiceDescriptor(entry) ? entry : normalizeProvider(entry);
    const dup = this.items.some(
      (x) =>
        x.token === d.token &&
        x.key === d.key &&
        x.kind === d.kind &&
        x.useClass === d.useClass &&
        x.useFactory === d.useFactory &&
        x.useExisting === d.useExisting &&
        (x.kind !== 'value' || x.useValue === d.useValue),
    );
    if (!dup) this.items.push(d);
    return this;
  }

  has(token: Token, key?: unknown): boolean {
    return this.items.some((d) => d.token === token && d.key === key);
  }

  /** Removes every registration for the token (and key). */
  remove(token: Token, key?: unknown): this {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i]!;
      if (d.token === token && d.key === key) this.items.splice(i, 1);
    }
    return this;
  }

  /** Removes all registrations for the entry's token, then adds it. */
  replace(entry: ServiceDescriptor | Provider): this {
    const d = isServiceDescriptor(entry) ? entry : normalizeProvider(entry);
    return this.remove(d.token, d.key).add(d);
  }

  /** Builds the root `ServiceProvider`. The collection may still be modified afterwards. */
  build(options?: ServiceProviderOptions): ServiceProvider {
    return buildServiceProvider([...this.items], options);
  }
}
