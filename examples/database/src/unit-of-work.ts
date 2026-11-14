import { type MiddlewareFn, middleware, type RequestContext } from '@sukujs/core';
import type { EntityManager } from 'typeorm';
import { TypeormConnection } from './typeorm.js';

const MANAGER = Symbol('transaction');

/** Thrown inside the transaction to roll it back while keeping the response already built. */
class Rollback extends Error {
  constructor(readonly response: Response) {
    super('rollback');
  }
}

/**
 * Runs the rest of the request inside one database transaction. It commits when the
 * response is a success and rolls back when it is an error, so a handler that fails halfway
 * leaves nothing behind.
 */
export const transactional: MiddlewareFn = middleware(async (ctx, next) => {
  const { dataSource } = ctx.provider.get(TypeormConnection);
  try {
    return await dataSource.transaction(async (manager) => {
      ctx.set(MANAGER, manager);
      const response = await next();
      // Errors are already rendered to a response by the time they reach a middleware.
      if (response.status >= 400) throw new Rollback(response);
      return response;
    });
  } catch (error) {
    if (error instanceof Rollback) return error.response;
    throw error;
  }
});

/** The transaction's manager for this request. Use it for every query in the handler. */
export function transaction(ctx: RequestContext): EntityManager {
  const manager = ctx.get<EntityManager>(MANAGER);
  if (!manager)
    throw new Error('No transaction: add the `transactional` middleware to this route.');
  return manager;
}
