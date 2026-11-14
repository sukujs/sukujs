import { type RequestContext, route, type ServiceOf } from '@sukujs/core';
import { GraphQLError } from 'graphql';
import { createSchema, createYoga } from 'graphql-yoga';
import { AuthorLoader, type Book, Books, type Viewer } from './services.js';

/** What Suku passes in for each request. */
interface ServerContext {
  ctx: RequestContext;
}

/** What resolvers receive: services resolved from the request's scope, plus the viewer. */
interface GraphQLContext extends ServerContext {
  books: ServiceOf<typeof Books>;
  authors: ServiceOf<typeof AuthorLoader>;
  viewer: Viewer | undefined;
}

const schema = createSchema<GraphQLContext>({
  typeDefs: /* GraphQL */ `
    type Author {
      id: ID!
      name: String!
    }
    type Book {
      id: ID!
      title: String!
      author: Author!
    }
    type Query {
      books: [Book!]!
      book(id: ID!): Book
      me: String
      authorFetches: Int!
      crash: String
    }
    type Mutation {
      addBook(title: String!, authorId: ID!): Book!
    }
    type Subscription {
      countdown(from: Int!): Int!
    }
  `,
  resolvers: {
    Query: {
      books: (_parent, _args, { books }) => books.all(),
      book: (_parent, { id }: { id: string }, { books }) => books.find(id) ?? null,
      me: (_parent, _args, { viewer }) => viewer?.id ?? null,
      authorFetches: (_parent, _args, { authors }) => authors.fetches,
      crash: () => {
        throw new Error('connection to db-internal-01 refused');
      },
    },
    Book: {
      author: (book: Book, _args, { authors }) => authors.load(book.authorId),
    },
    Mutation: {
      addBook: (
        _parent,
        { title, authorId }: { title: string; authorId: string },
        { books, viewer, ctx },
      ) => {
        if (viewer?.role !== 'editor') {
          throw new GraphQLError('Only editors can add books', {
            extensions: { code: 'FORBIDDEN' },
          });
        }
        const book = books.add(title, authorId);
        ctx.setHeader('x-created-book', book.id);
        return book;
      },
    },
    Subscription: {
      countdown: {
        async *subscribe(_parent, { from }: { from: number }) {
          for (let i = from; i >= 0; i--) yield { countdown: i };
        },
      },
    },
  },
});

export const yoga = createYoga<ServerContext, Omit<GraphQLContext, keyof ServerContext>>({
  schema,
  graphqlEndpoint: '/graphql',
  // Suku's own middlewares handle CORS, so Yoga's is turned off to avoid two sets of headers.
  cors: false,
  logging: false,
  context: ({ ctx }) => ({
    books: ctx.provider.get(Books),
    authors: ctx.provider.get(AuthorLoader),
    viewer: ctx.get<Viewer>('viewer'),
  }),
});

/** The whole GraphQL API is one Suku route. No `body` schema: Yoga reads the request itself. */
export const graphql = route.all('/graphql', {
  handle: ({ request, ctx }) => yoga.fetch(request, { ctx }),
});
