import { type Constructor, getInjectableOptions, ServiceCollection } from '@suku/di';
import { getControllerMetadata } from './controller.js';
import type { MiddlewareRef } from './enhancers.js';
import {
  getModuleMetadata,
  isDynamicModule,
  isModuleDefinition,
  type ModuleDefinition,
  type ModuleOptions,
  type ModuleRef,
  servicesOf,
} from './module.js';

export class ModuleError extends Error {
  override readonly name = 'ModuleError';
}

/** A module's identity: the decorated class, or the object `defineModule()` returned. */
export type ModuleId = Constructor | ModuleDefinition;

export interface ScannedModule {
  readonly id: ModuleId;
  readonly name: string;
  readonly options: ModuleOptions;
  readonly imports: ModuleId[];
}

export interface ScanResult {
  /** Every module reached from the root, parents after their imports (dependency order). */
  readonly modules: ScannedModule[];
  readonly controllers: Constructor[];
  /** Middleware declared on the module that owns each controller. */
  readonly controllerMiddleware: ReadonlyMap<Constructor, readonly MiddlewareRef[]>;
  readonly collection: ServiceCollection;
}

interface Resolved {
  id: ModuleId;
  name: string;
  /** Metadata declared on the class or definition. */
  base: ModuleOptions;
  /** Extra metadata a dynamic module adds on top of its class. */
  extra?: ModuleOptions;
  cls?: Constructor;
}

function nameOf(id: ModuleId): string {
  return typeof id === 'function' ? id.name || '<anonymous class>' : id.name;
}

async function resolve(ref: ModuleRef, chain: ModuleId[]): Promise<Resolved> {
  const r = await ref;
  if (isModuleDefinition(r)) return { id: r, name: r.name, base: r };
  if (isDynamicModule(r)) {
    const { module: cls, ...extra } = r;
    return { id: cls, name: nameOf(cls), base: getModuleMetadata(cls) ?? {}, extra, cls };
  }
  if (typeof r === 'function') {
    const base = getModuleMetadata(r);
    if (base) return { id: r, name: nameOf(r), base, cls: r };
  }
  const via = chain.map(nameOf).join(' -> ') || 'root';
  const what = typeof r === 'function' ? r.name : JSON.stringify(r);
  throw new ModuleError(
    `${what} is not a module (imported via ${via}). Use defineModule({ ... }) or decorate a class with @Module().`,
  );
}

/**
 * Walks the module graph from the root and flattens it into one `ServiceCollection`:
 * every service, every controller (as a service with its declared lifetime) and every
 * decorated module class (as a singleton, so lifecycle hooks can run on it).
 */
export async function scanModules(root: ModuleRef): Promise<ScanResult> {
  const collection = new ServiceCollection();
  const modules: ScannedModule[] = [];
  const controllers: Constructor[] = [];
  const seen = new Set<ModuleId>();
  const seenControllers = new Set<Constructor>();
  const controllerMiddleware = new Map<Constructor, readonly MiddlewareRef[]>();

  const register = (options: ModuleOptions, owner: string) => {
    for (const s of servicesOf(options)) collection.add(s);
    for (const c of options.controllers ?? []) {
      const meta = getControllerMetadata(c);
      if (!meta) {
        throw new ModuleError(
          `${c.name} is listed in ${owner}.controllers but is not decorated with @Controller().`,
        );
      }
      if (seenControllers.has(c)) continue;
      seenControllers.add(c);
      controllers.push(c);
      controllerMiddleware.set(c, options.middleware ?? []);
      // An explicit entry in `services` (e.g. a custom lifetime) wins over the implicit registration.
      if (!collection.has(c)) {
        const lifetime = meta.lifetime ?? getInjectableOptions(c)?.lifetime ?? 'singleton';
        collection.add({ provide: c, useClass: c, lifetime });
      }
    }
  };

  const visit = async (ref: ModuleRef, chain: ModuleId[]): Promise<ModuleId> => {
    const { id, name, base, extra, cls } = await resolve(ref, chain);
    if (chain.includes(id)) {
      throw new ModuleError(`Circular module import: ${[...chain, id].map(nameOf).join(' -> ')}`);
    }
    if (seen.has(id)) {
      // Same class imported again with different dynamic metadata: register only the extras.
      if (extra) {
        for (const imp of extra.imports ?? []) await visit(imp, [...chain, id]);
        register(extra, name);
      }
      return id;
    }
    seen.add(id);

    const imports: ModuleId[] = [];
    for (const imp of [...(base.imports ?? []), ...(extra?.imports ?? [])]) {
      imports.push(await visit(imp, [...chain, id]));
    }

    if (cls) collection.tryAddSingleton(cls);
    register(base, name);
    if (extra) register(extra, name);
    modules.push({ id, name, options: extra ? merge(base, extra) : base, imports });
    return id;
  };

  await visit(root, []);
  return { modules, controllers, controllerMiddleware, collection };
}

function merge(base: ModuleOptions, extra: ModuleOptions): ModuleOptions {
  const name = base.name ?? extra.name;
  return {
    ...(name === undefined ? {} : { name }),
    imports: [...(base.imports ?? []), ...(extra.imports ?? [])],
    controllers: [...(base.controllers ?? []), ...(extra.controllers ?? [])],
    middleware: [...(base.middleware ?? []), ...(extra.middleware ?? [])],
    services: [...servicesOf(base), ...servicesOf(extra)],
    exports: [...(base.exports ?? []), ...(extra.exports ?? [])],
  };
}
