import {
  type Constructor,
  defineMetadata,
  getOwnMetadata,
  type Provider,
  type ServiceDescriptor,
  type Token,
} from '@suku/di';
import type { MiddlewareRef } from './enhancers.js';
import { MODULE_KEY } from './keys.js';

export type ServiceEntry = Provider | ServiceDescriptor;

export interface ModuleOptions {
  /** Used in error messages and diagnostics. Defaults to a generated name. */
  name?: string;
  /** Modules whose controllers and services are included. */
  imports?: ModuleRef[];
  controllers?: Constructor[];
  /** Middleware applied to every controller declared in this module (not to imports). */
  middleware?: MiddlewareRef[];
  /**
   * Service registrations: bare classes (singleton unless `@Injectable({ lifetime })` says
   * otherwise), typed helpers such as `singleton(Logger, ConsoleLogger)`, or NestJS-style
   * `{ provide, useClass }` objects.
   */
  services?: ServiceEntry[];
  /** NestJS alias for `services`. */
  providers?: ServiceEntry[];
  /**
   * Recorded for documentation and future strict mode; v1 resolves from one flat
   * collection, so every service is visible to every module.
   */
  exports?: (Token | Constructor)[];
}

/** @deprecated Use `ModuleOptions`. Kept for NestJS-style code. */
export type ModuleMetadata = ModuleOptions;

const MODULE_DEF: unique symbol = Symbol.for('suku:module-definition');

/** The value returned by `defineModule()`. A plain object; compare by identity. */
export interface ModuleDefinition extends ModuleOptions {
  readonly [MODULE_DEF]: true;
  readonly name: string;
}

/** A module built at runtime from a decorated class, NestJS style (`ConfigModule.forRoot()`). */
export interface DynamicModule extends ModuleOptions {
  module: Constructor;
}

export type ModuleRef =
  | Constructor
  | ModuleDefinition
  | DynamicModule
  | Promise<ModuleDefinition | DynamicModule>;

let anonymous = 0;

/**
 * Declares a module as a plain, fully typed object. No class, no decorator.
 *
 * ```ts
 * export const UsersModule = defineModule({
 *   name: 'users',
 *   controllers: [UsersController],
 *   services: [singleton(UsersService), scoped(UnitOfWork)],
 * });
 *
 * // Parameterised modules are just functions:
 * export const ConfigModule = (schema: Schema) => defineModule({ services: [value(CONFIG, load(schema))] });
 * ```
 */
export function defineModule(options: ModuleOptions = {}): ModuleDefinition {
  return { ...options, name: options.name ?? `module#${++anonymous}`, [MODULE_DEF]: true };
}

export function isModuleDefinition(value: unknown): value is ModuleDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[MODULE_DEF] === true
  );
}

/**
 * NestJS-style module declaration on a class. Supported as an alias for people migrating;
 * `defineModule()` is the recommended form.
 */
export function Module(metadata: ModuleOptions = {}): ClassDecorator {
  return (target) => {
    defineMetadata(MODULE_KEY, metadata, target);
  };
}

export function getModuleMetadata(target: object): ModuleOptions | undefined {
  return getOwnMetadata<ModuleOptions>(MODULE_KEY, target);
}

export function isDynamicModule(value: unknown): value is DynamicModule {
  return (
    typeof value === 'object' && value !== null && 'module' in value && !isModuleDefinition(value)
  );
}

/** Every service entry of a module, `services` and `providers` combined. */
export function servicesOf(options: ModuleOptions): ServiceEntry[] {
  return [...(options.providers ?? []), ...(options.services ?? [])];
}
