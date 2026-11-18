import { type Constructor, defineMetadata, getOwnMetadata, type Lifetime } from '@sukujs/di';
import type { ErrorHandler, MiddlewareRef } from './middleware';

const ROUTES_KEY = 'suku:routes';

export interface RoutesOptions {
  /**
   * `singleton` (default): one instance for the app.
   * `scoped`: a fresh instance per request.
   * Omitting this is fine when the class injects a scoped service — Suku promotes it
   * to scoped automatically (Nest-like), same as setting `lifetime: 'scoped'` here.
   */
  lifetime?: Lifetime;
  middlewares?: MiddlewareRef[];
  onError?: ErrorHandler;
}

export interface RoutesMetadata extends RoutesOptions {
  prefix: string;
}

/**
 * Marks a class as a group of routes. Its fields created with `route.*` become routes under
 * `prefix`, and its constructor is injected like any service.
 *
 * ```ts
 * @Routes('/users')
 * class UsersRoutes {
 *   constructor(private readonly users: UsersService) {}
 *   findOne = route.get('/:id', { handle: ({ params }) => this.users.find(params.id) });
 * }
 * ```
 */
export function Routes(prefix = '', options: RoutesOptions = {}): ClassDecorator {
  return (target) => {
    defineMetadata(ROUTES_KEY, { prefix, ...options } satisfies RoutesMetadata, target);
  };
}

export function getRoutesMetadata(target: object): RoutesMetadata | undefined {
  return getOwnMetadata<RoutesMetadata>(ROUTES_KEY, target);
}

export function isRoutesClass(value: unknown): value is Constructor {
  return typeof value === 'function' && getRoutesMetadata(value) !== undefined;
}
