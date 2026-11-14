import { type MiddlewareFn, middleware, route, Suku, type SukuOptions } from '@suku/core';
import { cors } from '@suku/security';
import { graphql } from './graphql.js';
import { AuthorLoader, Books, type Viewer } from './services.js';

/** Reads the viewer from a header. A real app would verify a token here. */
export const authenticate: MiddlewareFn = middleware((ctx, next) => {
  const role = ctx.headers.get('x-role');
  if (role === 'reader' || role === 'editor')
    ctx.set<Viewer>('viewer', { id: `user-${role}`, role });
  return next();
});

/** A REST route beside the GraphQL one, using the same service. */
export const listBooks = route.get('/books', {
  services: { books: Books },
  handle: ({ books }) => books.all(),
});

export const createApp = (options: SukuOptions = {}) =>
  Suku.create({
    routes: [graphql, listBooks],
    services: [Books, AuthorLoader],
    middlewares: [cors({ origin: ['https://app.example.com'] }), authenticate],
    ...options,
  });
