import { Routes, route, UnauthorizedException, middleware } from '@sukujs/core';
import { apiDoc } from '@sukujs/openapi';
import { z } from 'zod';
import { Book, BookId, BookQuery, NewBook } from './books.schemas';
import { BooksService } from './books.service';

/** A stand-in for real authentication: any bearer token is accepted. */
const requireToken = middleware(async (ctx, next) => {
  if (!ctx.headers.get('authorization')?.startsWith('Bearer ')) {
    throw new UnauthorizedException('Send a bearer token');
  }
  return next();
});

@Routes('/books')
export class BooksRoutes {
  constructor(private readonly books: BooksService) {}

  // Reading is public: `security: []` removes the lock the document puts on every route.
  list = route.get('/', {
    meta: apiDoc({ summary: 'List books', security: [] }),
    query: BookQuery,
    response: z.array(Book),
    handle: ({ query }) => this.books.list(query.author, query.limit),
  });

  findOne = route.get('/:id', {
    meta: apiDoc({
      summary: 'Get a book',
      security: [],
      responses: { 404: 'No book with this id' },
    }),
    params: BookId,
    response: Book,
    handle: ({ params }) => this.books.find(params.id),
  });

  create = route.post('/', {
    meta: apiDoc({ summary: 'Add a book', responses: { 401: 'No bearer token' } }),
    middlewares: [requireToken],
    body: NewBook,
    response: Book,
    handle: ({ body }) => this.books.add(body),
  });

  remove = route.delete('/:id', {
    meta: apiDoc({
      summary: 'Remove a book',
      responses: { 401: 'No bearer token', 404: 'No book with this id' },
    }),
    middlewares: [requireToken],
    params: BookId,
    status: 204,
    handle: ({ params }) => this.books.remove(params.id),
  });
}
