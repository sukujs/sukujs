import type { ServiceCollection, ServiceProvider, ServiceProviderOptions, Token } from '@suku/di';
import type {
  CloseOptions,
  FetchHandler,
  HttpServer,
  PlatformAdapter,
  ServeOptions,
} from './adapter.js';
import { RequestContext } from './context.js';
import type { FilterRef, GuardRef, InterceptorRef, MiddlewareRef, PipeRef } from './enhancers.js';
import {
  collectEnhancerClasses,
  contextOf,
  createKernel,
  type Kernel,
  type KernelOptions,
  type RouteTableEntry,
  registerEnhancerClasses,
} from './kernel.js';
import { ConsoleLogger, Logger } from './logger.js';
import {
  defineModule,
  isDynamicModule,
  isModuleDefinition,
  type ModuleOptions,
  type ModuleRef,
} from './module.js';
import { scanModules } from './scanner.js';

export interface SukuOptions extends KernelOptions {
  /** Required for `listen()`. `handle()` works without one, which is how tests run. */
  adapter?: PlatformAdapter;
  /** Container options. `validateOnBuild` defaults to `true` so misconfiguration fails at startup. */
  di?: ServiceProviderOptions;
  /** Last chance to add or replace services before the container is built. */
  configureServices?: (services: ServiceCollection) => void;
}

/**
 * An application declared in one object: module options and app options together, like a
 * .NET `Program.cs`. `Suku.create({ imports: [UsersModule], adapter: nodeAdapter() })`.
 */
export type InlineApp = ModuleOptions & SukuOptions;

const APP_OPTION_KEYS = [
  'adapter',
  'di',
  'configureServices',
  'globalPrefix',
  'onError',
  'bodyLimit',
  'middleware',
  'guards',
  'interceptors',
  'pipes',
  'filters',
] as const;

function splitInline(inline: InlineApp): { root: ModuleRef; options: SukuOptions } {
  const options: Record<string, unknown> = {};
  const module: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inline)) {
    if ((APP_OPTION_KEYS as readonly string[]).includes(k)) options[k] = v;
    else module[k] = v;
  }
  return {
    root: defineModule({ name: 'root', ...(module as ModuleOptions) }),
    options: options as SukuOptions,
  };
}

export class SukuApplication {
  private server: HttpServer | undefined;
  private closed = false;

  private constructor(
    readonly provider: ServiceProvider,
    private readonly kernel: Kernel,
    private readonly options: SukuOptions,
  ) {}

  static async create(
    root: ModuleRef | InlineApp,
    options: SukuOptions = {},
  ): Promise<SukuApplication> {
    if (
      typeof root === 'object' &&
      root !== null &&
      !(root instanceof Promise) &&
      !isModuleDefinition(root) &&
      !isDynamicModule(root)
    ) {
      const split = splitInline(root as InlineApp);
      root = split.root;
      options = { ...split.options, ...options };
    }
    const scan = await scanModules(root as ModuleRef);
    scan.collection.addScoped(RequestContext, (sp) => {
      const ctx = contextOf(sp);
      if (!ctx) throw new Error('RequestContext is only available inside a request scope.');
      return ctx;
    });
    registerEnhancerClasses(scan.collection, collectEnhancerClasses(scan, options));
    scan.collection.tryAddSingleton(Logger, ConsoleLogger);
    options.configureServices?.(scan.collection);
    const provider = scan.collection.build({ validateOnBuild: true, ...options.di });
    const kernel = createKernel(scan, provider, options);
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

  private addGlobal<T>(
    kind: 'middleware' | 'guards' | 'interceptors' | 'pipes' | 'filters',
    refs: T[],
  ): this {
    for (const ref of refs) {
      if (
        typeof ref === 'function' &&
        ref.prototype !== undefined &&
        !this.provider.has(ref as never)
      ) {
        const name = (ref as { name?: string }).name ?? 'class';
        throw new Error(
          `${name} is not registered. Pass it in Suku.create({ ${kind}: [${name}] }) so it is registered before the ` +
            "container is built, add it to a module's services, or pass an instance instead.",
        );
      }
      (this.kernel.globals[kind] as T[]).push(ref);
    }
    return this;
  }

  /** Adds global middleware. Runs for every request, matched or not, before module and controller middleware. */
  use(...middleware: MiddlewareRef[]): this {
    return this.addGlobal('middleware', middleware);
  }
  useGlobalGuards(...guards: GuardRef[]): this {
    return this.addGlobal('guards', guards);
  }
  useGlobalInterceptors(...interceptors: InterceptorRef[]): this {
    return this.addGlobal('interceptors', interceptors);
  }
  useGlobalPipes(...pipes: PipeRef[]): this {
    return this.addGlobal('pipes', pipes);
  }
  useGlobalFilters(...filters: FilterRef[]): this {
    return this.addGlobal('filters', filters);
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
