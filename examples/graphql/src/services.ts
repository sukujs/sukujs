import { RequestContext, service } from '@sukujs/core';

export interface Book {
  id: string;
  title: string;
  authorId: string;
}

export interface Viewer {
  id: string;
  role: 'reader' | 'editor';
}

/** A singleton service. The same instance backs REST routes and GraphQL resolvers. */
export const Books = service('books', () => {
  const books = new Map<string, Book>([
    ['1', { id: '1', title: 'Dune', authorId: 'a1' }],
    ['2', { id: '2', title: 'Emma', authorId: 'a2' }],
  ]);
  return {
    all: () => [...books.values()],
    find: (id: string) => books.get(id),
    add(title: string, authorId: string): Book {
      const book = { id: String(books.size + 1), title, authorId };
      books.set(book.id, book);
      return book;
    },
  };
});

/**
 * A request-scoped service: one instance per request. A real one would batch database
 * lookups (a DataLoader); this one counts how many times each author is fetched.
 */
export const AuthorLoader = service('author-loader', {
  lifetime: 'scoped',
  services: { ctx: RequestContext },
  create: () => {
    const cache = new Map<string, { id: string; name: string }>();
    let fetches = 0;
    return {
      load(id: string) {
        let author = cache.get(id);
        if (!author) {
          fetches++;
          author = { id, name: id === 'a1' ? 'Frank Herbert' : 'Jane Austen' };
          cache.set(id, author);
        }
        return author;
      },
      get fetches() {
        return fetches;
      },
    };
  },
});
