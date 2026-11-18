import type {
  InjectionToken,
  ServiceCollection,
  ServiceProvider,
  ServiceProviderOptions,
  Token,
} from '@sukujs/di';
import type {
  CloseOptions,
  FetchHandler,
  HttpServer,
  PlatformAdapter,
  ServeOptions,
} from './adapter';
import { RequestContext } from './context';
import {
  type Feature,
  type FeatureRef,
  feature,
  isFeature,
  type RouteEntry,
  type ServiceEntry,
} from './feature';
import {
  contextOf,
  createKernel,
  type Kernel,
  type KernelOptions,
  type RegisteredRoute,
  type RouteTableEntry,
} from './kernel';
import { ConsoleLogger, Logger } from './logger';
import type { MiddlewareRef } from './middleware';
import { scanFeatures } from './scanner';

export interface SukuOptions extends KernelOptions {
  /** Required for `listen()`. `handle()` works without one, which is how tests run. */
  adapter?: PlatformAdapter;
  /** Features that make up the app. */
  features?: FeatureRef[];
  /** Routes declared directly on the app, for small services that need no feature. */
  routes?: RouteEntry[];
  /** Services declared directly on the app. */
  services?: ServiceEntry[];
  /** Container options. `validateOnBuild` defaults to `true` so misconfiguration fails at startup. */
  di?: ServiceProviderOptions;
  /** Last chance to add or replace services before the container is built. */
  configureServices?: (services: ServiceCollection) => void;
}

/**
 * Every route the app serves, with its full path, feature and options. Injectable anywhere,
 * and readable in a handler with `ctx.provider.get(ROUTE_TABLE)`.
 */
// A global symbol rather than a token instance, like the route and feature markers: a package
// that ends up with its own copy of core (a linked workspace, a duplicate install) still asks
// for the same service.
export const ROUTE_TABLE = Symbol.for('suku:route-table') as unknown as InjectionToken<
  readonly RegisteredRoute[]
>;

export class SukuApplication {
  private server: HttpServer | undefined;
  private closed = false;

  private constructor(
    readonly provider: ServiceProvider,
    private readonly kernel: Kernel,
    private readonly options: SukuOptions,
  ) {}

  /**
   * Builds an application, like a .NET `Program.cs`:
   *
   * ```ts
   * const app = await Suku.create({ features: [UsersFeature], adapter: nodeAdapter() });
   * ```
   *
   * A single root feature may be passed first: `Suku.create(AppFeature, { adapter })`.
   */
  static async create(options?: SukuOptions): Promise<SukuApplication>;
  static async create(
    root: Feature | Promise<Feature>,
    options?: SukuOptions,
  ): Promise<SukuApplication>;
  static async create(
    a: Feature | Promise<Feature> | SukuOptions = {},
    b: SukuOptions = {},
  ): Promise<SukuApplication> {
    let options: SukuOptions;
    let imports: FeatureRef[];
    if (a instanceof Promise || isFeature(a)) {
      options = b;
      imports = [a, ...(b.features ?? [])];
    } else {
      options = a;
      imports = a.features ?? [];
    }
    const root = feature('app', {
      imports,
      ...(options.routes ? { routes: options.routes } : {}),
      ...(options.services ? { services: options.services } : {}),
    });

    const scan = await scanFeatures(root);
    scan.collection.addScoped(RequestContext, (sp) => {
      const ctx = contextOf(sp);
      if (!ctx) throw new Error('RequestContext is only available inside a request scope.');
      return ctx;
    });
    scan.collection.tryAddSingleton(Logger, ConsoleLogger);
    // Registered before the container is built, filled once the kernel has compiled the routes.
    const routeTable: RegisteredRoute[] = [];
    scan.collection.add({ provide: ROUTE_TABLE, useValue: routeTable });
    options.configureServices?.(scan.collection);
    const provider = scan.collection.build({ validateOnBuild: true, ...options.di });
    const kernel = createKernel(scan, provider, options);
    routeTable.push(...kernel.registered);
    return new SukuApplication(provider, kernel, options);
  }

  /** In-process entry point: feed it a `Request`, get a `Response`. No sockets involved. */
  get handle(): FetchHandler {
    return this.kernel.handle;
  }

  get routes(): readonly RouteTableEntry[] {
    return this.kernel.routes;
  }

  /** Origin of the listening server, once `listen()` resolved. */
  get url(): string | undefined {
    return this.server?.url;
  }

  /** Resolves a singleton from the root container. */
  get<T>(token: Token<T>): T {
    return this.provider.get(token);
  }

  /** Adds app-level middlewares. They run for every request, matched or not. */
  use(...middlewares: MiddlewareRef[]): this {
    this.kernel.middlewares.push(...middlewares);
    return this;
  }

  async listen(
    portOrOptions: number | ServeOptions = 3000,
    hostname?: string,
  ): Promise<HttpServer> {
    if (!this.options.adapter) {
      throw new Error(
        'No platform adapter configured. Pass `adapter: nodeAdapter()` (or bunAdapter()) to Suku.create().',
      );
    }
    if (this.server) return this.server;
    const serve: ServeOptions =
      typeof portOrOptions === 'number'
        ? hostname === undefined
          ? { port: portOrOptions }
          : { port: portOrOptions, hostname }
        : portOrOptions;
    this.server = await this.options.adapter.serve(this.kernel.handle, serve);
    return this.server;
  }

  /** Stops the server (if listening) and disposes every singleton. */
  async close(options?: CloseOptions): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.server?.close(options);
    this.server = undefined;
    await this.provider.dispose();
  }
}

export const Suku = {
  create: SukuApplication.create,
};
