import type { ServiceDescriptor } from './descriptor.js';
import {
  CaptiveDependencyError,
  CircularDependencyError,
  MissingServiceError,
  ProviderDisposedError,
  ScopedFromRootError,
} from './errors.js';
import { getConstructorParameters } from './reflection.js';
import type { Constructor, Token } from './types.js';

export interface ServiceProviderOptions {
  /**
   * Throw when a scoped service is resolved from the root provider, which is how a
   * singleton capturing a scoped dependency is caught at runtime. Default `true`.
   */
  validateScopes?: boolean;
  /**
   * Walk every class registration at build time and fail fast on missing
   * dependencies, cycles, and captive dependencies. Default `false` (turn on in tests
   * and development).
   */
  validateOnBuild?: boolean;
}

interface Disposable {
  dispose?: () => unknown;
  onDispose?: () => unknown;
  [Symbol.dispose]?: () => void;
  [Symbol.asyncDispose]?: () => PromiseLike<void>;
}

const ASYNC_DISPOSE: typeof Symbol.asyncDispose | undefined = (Symbol as any).asyncDispose;
const SYNC_DISPOSE: typeof Symbol.dispose | undefined = (Symbol as any).dispose;

function isDisposable(value: unknown): value is Disposable {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Disposable;
  return (
    typeof v.dispose === 'function' ||
    typeof v.onDispose === 'function' ||
    (ASYNC_DISPOSE !== undefined && typeof v[ASYNC_DISPOSE] === 'function') ||
    (SYNC_DISPOSE !== undefined && typeof v[SYNC_DISPOSE] === 'function')
  );
}

async function disposeOne(value: Disposable): Promise<void> {
  if (ASYNC_DISPOSE && typeof value[ASYNC_DISPOSE] === 'function') {
    await value[ASYNC_DISPOSE]();
  } else if (SYNC_DISPOSE && typeof value[SYNC_DISPOSE] === 'function') {
    value[SYNC_DISPOSE]();
  } else if (typeof value.dispose === 'function') {
    await value.dispose();
  } else if (typeof value.onDispose === 'function') {
    await value.onDispose();
  }
}

/**
 * Resolves services. The root provider is returned by `ServiceCollection.build()`;
 * `createScope()` returns a child provider with its own scoped instances.
 *
 * `ServiceProvider` is itself injectable: a class that declares a `ServiceProvider`
 * constructor parameter receives the provider it is being resolved from.
 */
export abstract class ServiceProvider {
  abstract readonly isRoot: boolean;
  /** The application's root provider. For a root provider, itself. */
  abstract readonly root: ServiceProvider;

  /** Resolves the last registration for `token`; throws `MissingServiceError` if none. */
  abstract get<T>(token: Token<T>): T;
  abstract getOptional<T>(token: Token<T>): T | undefined;
  /** Resolves every registration for `token`, in registration order. */
  abstract getAll<T>(token: Token<T>): T[];
  abstract getKeyed<T>(token: Token<T>, key: unknown): T;
  abstract getKeyedOptional<T>(token: Token<T>, key: unknown): T | undefined;
  abstract has(token: Token, key?: unknown): boolean;

  /**
   * Constructs a class that is not registered, resolving its constructor parameters from
   * this provider (like .NET's `ActivatorUtilities.CreateInstance`). The instance is owned by
   * this provider and disposed with it.
   */
  abstract create<T>(cls: Constructor<T>): T;

  /** Creates a child provider. Dispose it to release scoped and transient instances it created. */
  abstract createScope(): ServiceProvider;
  /** Disposes instances this provider owns, newest first, then child scopes (root only). */
  abstract dispose(): Promise<void>;

  /** Enables `await using provider = collection.build()`. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }
}

class Registry {
  readonly byToken = new Map<Token, ServiceDescriptor[]>();
  readonly keyed = new Map<Token, Map<unknown, ServiceDescriptor[]>>();
  /** Active resolution chain. Resolution is synchronous, so one stack suffices. */
  readonly stack: ServiceDescriptor[] = [];
  readonly options: Required<ServiceProviderOptions>;

  constructor(
    readonly descriptors: readonly ServiceDescriptor[],
    options: ServiceProviderOptions,
  ) {
    this.options = {
      validateScopes: options.validateScopes ?? true,
      validateOnBuild: options.validateOnBuild ?? false,
    };
    for (const d of descriptors) {
      if (d.key === undefined) {
        push(this.byToken, d.token, d);
      } else {
        let perKey = this.keyed.get(d.token);
        if (!perKey) {
          perKey = new Map();
          this.keyed.set(d.token, perKey);
        }
        push(perKey, d.key, d);
      }
    }
  }

  lookup(token: Token, key: unknown): ServiceDescriptor[] | undefined {
    return key === undefined ? this.byToken.get(token) : this.keyed.get(token)?.get(key);
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

class Container extends ServiceProvider {
  // Allocated lazily: a scope is created per request and most never resolve a scoped service.
  private cache: Map<ServiceDescriptor, unknown> | null = null;
  private disposables: Disposable[] | null = null;
  private children: Set<Container> | null = null;
  private disposed = false;

  constructor(
    private readonly registry: Registry,
    private readonly parent: Container | null,
  ) {
    super();
  }

  get isRoot(): boolean {
    return this.parent === null;
  }

  get root(): ServiceProvider {
    return this.parent ?? this;
  }

  get<T>(token: Token<T>): T {
    return this.resolveToken(token, undefined, false) as T;
  }

  getOptional<T>(token: Token<T>): T | undefined {
    return this.resolveToken(token, undefined, true) as T | undefined;
  }

  getKeyed<T>(token: Token<T>, key: unknown): T {
    return this.resolveToken(token, key, false) as T;
  }

  getKeyedOptional<T>(token: Token<T>, key: unknown): T | undefined {
    return this.resolveToken(token, key, true) as T | undefined;
  }

  getAll<T>(token: Token<T>): T[] {
    this.assertAlive();
    const list = this.registry.lookup(token, undefined);
    if (!list) return token === ServiceProvider ? [this as unknown as T] : [];
    return list.map((d) => this.resolve(d) as T);
  }

  has(token: Token, key?: unknown): boolean {
    return token === ServiceProvider || (this.registry.lookup(token, key)?.length ?? 0) > 0;
  }

  create<T>(cls: Constructor<T>): T {
    this.assertAlive();
    const instance = this.construct(cls);
    this.track(instance);
    return instance as T;
  }

  createScope(): ServiceProvider {
    this.assertAlive();
    const rootContainer = this.parent ?? this;
    const scope = new Container(this.registry, rootContainer);
    (rootContainer.children ??= new Set()).add(scope);
    return scope;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.parent?.children?.delete(this);
    if (this.children) {
      for (const child of [...this.children].reverse()) await child.dispose();
      this.children = null;
    }
    if (this.disposables) {
      for (let i = this.disposables.length - 1; i >= 0; i--) {
        await disposeOne(this.disposables[i]!);
      }
      this.disposables = null;
    }
    this.cache = null;
  }

  // --- internals -------------------------------------------------------------

  private assertAlive() {
    if (this.disposed) throw new ProviderDisposedError();
  }

  private resolveToken(token: Token, key: unknown, optional: boolean): unknown {
    this.assertAlive();
    if (token === ServiceProvider && key === undefined) return this;
    const list = this.registry.lookup(token, key);
    if (!list || list.length === 0) {
      if (optional) return undefined;
      throw new MissingServiceError(token, key, [...this.registry.stack]);
    }
    return this.resolve(list[list.length - 1]!);
  }

  private resolve(d: ServiceDescriptor): unknown {
    switch (d.kind) {
      case 'value':
        return d.useValue;
      case 'existing':
        return this.resolveToken(d.useExisting!, undefined, false);
      default:
        break;
    }
    switch (d.lifetime) {
      case 'singleton':
        return (this.parent ?? this).getOrCreate(d);
      case 'scoped':
        if (this.isRoot && this.registry.options.validateScopes) {
          throw new ScopedFromRootError(d, [...this.registry.stack]);
        }
        return this.getOrCreate(d);
      case 'transient': {
        const instance = this.instantiate(d);
        this.track(instance);
        return instance;
      }
    }
  }

  private getOrCreate(d: ServiceDescriptor): unknown {
    const cache = (this.cache ??= new Map());
    if (cache.has(d)) return cache.get(d);
    const instance = this.instantiate(d);
    cache.set(d, instance);
    this.track(instance);
    return instance;
  }

  /** Creates an instance, resolving its dependencies from `this`. */
  private instantiate(d: ServiceDescriptor): unknown {
    const stack = this.registry.stack;
    if (stack.includes(d)) throw new CircularDependencyError([...stack, d]);
    stack.push(d);
    try {
      if (d.kind === 'factory') return d.useFactory!(this);
      return this.construct(d.useClass!);
    } finally {
      stack.pop();
    }
  }

  private construct(cls: Constructor): unknown {
    const params = getConstructorParameters(cls);
    const args = new Array(params.length);
    for (const p of params) args[p.index] = this.resolveToken(p.token, p.key, p.optional);
    return new cls(...args);
  }

  private track(instance: unknown) {
    if (isDisposable(instance)) (this.disposables ??= []).push(instance);
  }
}

/** Static checks run when `validateOnBuild` is set. */
function validate(registry: Registry): void {
  const { validateScopes } = registry.options;

  const resolveDependency = (p: { token: Token; key?: unknown }): ServiceDescriptor | undefined => {
    const list = registry.lookup(p.token, p.key);
    return list?.[list.length - 1];
  };

  /** Follows `useExisting` aliases to the descriptor that actually produces the instance. */
  const concrete = (
    d: ServiceDescriptor,
    seen = new Set<ServiceDescriptor>(),
  ): ServiceDescriptor => {
    if (d.kind !== 'existing' || seen.has(d)) return d;
    seen.add(d);
    const target = resolveDependency({ token: d.useExisting! });
    return target ? concrete(target, seen) : d;
  };

  const dependenciesOf = (d: ServiceDescriptor): ServiceDescriptor[] => {
    const c = concrete(d);
    if (c.kind === 'factory' && c.dependsOn) {
      const declared: ServiceDescriptor[] = [];
      for (const token of c.dependsOn) {
        if (token === ServiceProvider) continue;
        const dep = resolveDependency({ token });
        if (!dep) throw new MissingServiceError(token, undefined, [d]);
        declared.push(dep);
      }
      return declared;
    }
    if (c.kind !== 'class') return [];
    const deps: ServiceDescriptor[] = [];
    for (const p of getConstructorParameters(c.useClass!)) {
      if (p.token === ServiceProvider) continue;
      const dep = resolveDependency(p);
      if (!dep) {
        if (p.optional) continue;
        throw new MissingServiceError(p.token, p.key, [d]);
      }
      deps.push(dep);
    }
    return deps;
  };

  const rank: Record<string, number> = { singleton: 2, scoped: 1, transient: 0 };

  // Pass 1: resolvability and captive dependencies.
  for (const d of registry.descriptors) {
    for (const dep of dependenciesOf(d)) {
      const target = concrete(dep);
      if (
        validateScopes &&
        d.kind !== 'value' &&
        target.kind !== 'value' &&
        d.lifetime === 'singleton' &&
        target.lifetime === 'scoped'
      ) {
        throw new CaptiveDependencyError(d, target);
      }
      // A scoped service holding a transient is fine; singleton->transient is fine too
      // (.NET semantics). Only longer-lived -> scoped is a captive.
      void rank;
    }
  }

  // Pass 2: cycles, via DFS over class dependencies.
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<ServiceDescriptor, number>();
  const path: ServiceDescriptor[] = [];
  const visit = (d: ServiceDescriptor) => {
    const c = color.get(d) ?? WHITE;
    if (c === BLACK) return;
    if (c === GREY) {
      const start = path.indexOf(d);
      throw new CircularDependencyError([...path.slice(start), d]);
    }
    color.set(d, GREY);
    path.push(d);
    for (const dep of dependenciesOf(d)) visit(dep);
    path.pop();
    color.set(d, BLACK);
  };
  for (const d of registry.descriptors) visit(d);
}

export function buildServiceProvider(
  descriptors: readonly ServiceDescriptor[],
  options: ServiceProviderOptions = {},
): ServiceProvider {
  const registry = new Registry(descriptors, options);
  if (registry.options.validateOnBuild) validate(registry);
  return new Container(registry, null);
}
