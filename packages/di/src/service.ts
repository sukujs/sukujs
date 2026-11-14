import type { ServiceDescriptor } from './descriptor.js';
import type { ServiceProvider } from './provider.js';
import { InjectionToken, type Lifetime, type Token } from './types.js';

/** Dependencies a classless service asks for: `{ db: Database }` arrives as `{ db }` in `create`. */
export type Dependencies = Record<string, Token>;
export type ResolvedDependencies<D> = { [K in keyof D]: D[K] extends Token<infer T> ? T : never };

export interface ServiceDefinitionOptions<T, D extends Dependencies> {
  /** `singleton` (default), `scoped` (one per request) or `transient`. */
  lifetime?: Lifetime;
  /** Other services this one needs, resolved by the container and passed to `create` by name. */
  services?: D;
  /** Builds the service. Whatever it returns is the service; its type is inferred. */
  create: (deps: ResolvedDependencies<D>) => T;
}

/**
 * A service declared without a class. It is its own injection token and carries its own
 * registration, so it can be listed in `services`, injected with `@Inject(Def)`, and named in
 * a route's or another service's `services`.
 */
export class ServiceDefinition<T = unknown> extends InjectionToken<T> {
  readonly descriptor: ServiceDescriptor<T>;

  constructor(
    name: string,
    lifetime: Lifetime,
    dependencies: Dependencies,
    create: (deps: any) => T,
  ) {
    super(name);
    const entries = Object.entries(dependencies);
    this.descriptor = {
      kind: 'factory',
      token: this,
      lifetime,
      dependsOn: entries.map(([, token]) => token),
      useFactory: (provider: ServiceProvider) => {
        const deps: Record<string, unknown> = {};
        for (const [key, token] of entries) deps[key] = provider.get(token);
        return create(deps);
      },
    };
  }
}

/** The type a token, class or `service()` definition resolves to. */
export type ServiceOf<K> = K extends Token<infer T> ? T : never;

/**
 * Declares a service without a class.
 *
 * ```ts
 * export const Users = service('users', {
 *   services: { db: Database },
 *   create: ({ db }) => ({
 *     find: (id: number) => db.users.get(id),
 *   }),
 * });
 *
 * // No dependencies: pass the factory directly.
 * export const Clock = service('clock', () => ({ now: () => new Date() }));
 * ```
 */
export function service<T>(name: string, create: () => T): ServiceDefinition<T>;
export function service<T, D extends Dependencies = {}>(
  name: string,
  options: ServiceDefinitionOptions<T, D>,
): ServiceDefinition<T>;
export function service<T>(
  name: string,
  optionsOrCreate: ServiceDefinitionOptions<T, Dependencies> | (() => T),
): ServiceDefinition<T> {
  if (typeof optionsOrCreate === 'function')
    return new ServiceDefinition(name, 'singleton', {}, optionsOrCreate);
  const { lifetime = 'singleton', services = {}, create } = optionsOrCreate;
  return new ServiceDefinition(name, lifetime, services, create);
}
