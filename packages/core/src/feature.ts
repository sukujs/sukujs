import type { Constructor, Provider, ServiceDescriptor } from '@suku/di';
import type { ErrorHandler, MiddlewareRef } from './middleware.js';
import type { Route, RouteGroup } from './route.js';

export type ServiceEntry = Provider | ServiceDescriptor;
/** A standalone route, a `route.group(...)`, or a class decorated with `@Routes`. */
export type RouteEntry = Route | RouteGroup | Constructor;

export interface FeatureOptions {
  /** Prepended to the paths of this feature's own routes. */
  prefix?: string;
  /** Other features to include. Each is registered once, however many features import it. */
  imports?: FeatureRef[];
  routes?: RouteEntry[];
  /**
   * Service registrations: typed helpers such as `singleton(Logger, ConsoleLogger)`, or bare
   * classes (singleton unless `@Service({ lifetime })` says otherwise).
   */
  services?: ServiceEntry[];
  /** Applied to this feature's own routes, after app-level middlewares. */
  middlewares?: MiddlewareRef[];
  /** Handles errors from this feature's own routes before the app-level handler. */
  onError?: ErrorHandler;
}

const FEATURE: unique symbol = Symbol.for('suku:feature');

/** The value returned by `feature()`. A plain object, compared by identity. */
export interface Feature extends FeatureOptions {
  readonly [FEATURE]: true;
  readonly name: string;
}

export type FeatureRef = Feature | Promise<Feature>;

/**
 * Declares a feature: the routes, services and middlewares of one part of the app.
 *
 * ```ts
 * export const UsersFeature = feature('users', {
 *   routes: [UsersRoutes],
 *   services: [singleton(UsersService)],
 * });
 *
 * // A feature that takes options is a function:
 * export const MailFeature = (opts: MailOptions) => feature('mail', { services: [value(MAIL, opts)] });
 * ```
 */
export function feature(name: string, options: FeatureOptions = {}): Feature {
  return { ...options, name, [FEATURE]: true };
}

export function isFeature(value: unknown): value is Feature {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[FEATURE] === true
  );
}
