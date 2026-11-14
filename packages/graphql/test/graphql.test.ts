import { describe, expect, test } from 'bun:test';
import {
  feature,
  middleware,
  RequestContext,
  Routes,
  route,
  Service,
  Suku,
  type SukuOptions,
  scoped,
  service,
} from '@suku/core';
import { z } from 'zod';
import sukuGraphql, {
  createGraphqlSchema,
  GraphqlResolver,
  GraphqlSetupError,
  graphql,
  mutation,
  objectType,
  query,
  subscription,
} from '../src/index.js';

interface Book {
  id: string;
  title: string;
  authorId: string;
}

@Service()
class BooksService {
  private readonly books: Book[] = [
    { id: '1', title: 'Dune', authorId: 'a1' },
    { id: '2', title: 'Emma', authorId: 'a2' },
  ];
  all() {
    return this.books;
  }
  find(id: string) {
    return this.books.find((b) => b.id === id);
  }
  add(title: string, authorId: string): Book {
    const book = { id: String(this.books.length + 1), title, authorId };
    this.books.push(book);
    return book;
  }
}

let loaders = 0;
const AuthorLoader = service('author-loader', {
  lifetime: 'scoped',
  create: () => {
    const id = ++loaders;
    return {
      id,
      load: (authorId: string) => ({
        id: authorId,
        name: authorId === 'a1' ? 'Frank Herbert' : 'Jane Austen',
      }),
    };
  },
});

@GraphqlResolver({
  typeDefs: /* GraphQL */ `
    type Author { id: ID! name: String! }
    type Book { id: ID! title: String! author: Author! }
    extend type Query {
      books: [Book!]!
      book(id: ID!): Book
      me: String
      loaderId: Int!
      renamed: String!
      crash: String
    }
    extend type Mutation { addBook(title: String!, authorId: ID!): Book! }
    extend type Subscription { countdown(from: Int!): Int! }
  `,
})
class BooksResolver {
  static instances = 0;
  constructor(private readonly books: BooksService) {
    BooksResolver.instances++;
  }

  books_ = query({ name: 'books', handle: () => this.books.all() });

  book = query({
    args: z.object({ id: z.string().min(1) }),
    handle: ({ args }) => this.books.find(args.id) ?? null,
  });

  me = query({ handle: ({ ctx }) => ctx.get<string>('viewer') ?? null });

  loaderId = query({ services: { loader: AuthorLoader }, handle: ({ loader }) => loader.id });

  aliased = query({ name: 'renamed', handle: () => 'ok' });

  crash = query({
    handle: () => {
      throw new Error('connection to db-internal-01 refused');
    },
  });

  author = objectType<Book>('Book').field({
    services: { loader: AuthorLoader },
    handle: ({ parent, loader }) => loader.load(parent.authorId),
  });

  addBook = mutation({
    args: z.object({ title: z.string().min(2), authorId: z.string() }),
    handle: ({ args, ctx }) => {
      const book = this.books.add(args.title, args.authorId);
      ctx.setHeader('x-created-book', book.id);
      ctx.cookies.set('last-book', book.id);
      return book;
    },
  });

  countdown = subscription({
    args: z.object({ from: z.number().int().min(0).max(5) }),
    handle: async function* ({ args }) {
      for (let i = args.from; i >= 0; i--) yield i;
    },
  });

  notAResolver = 'ignored';
}

@Routes('/books')
class BooksRoutes {
  constructor(private readonly books: BooksService) {}
  list = route.get('/', { handle: () => this.books.all() });
}

const BooksFeature = feature('books', {
  routes: [BooksRoutes],
  services: [BooksService, AuthorLoader, BooksResolver],
});

const viewer = middleware((ctx, next) => {
  const who = ctx.headers.get('x-user');
  if (who) ctx.set('viewer', who);
  return next();
});

const create = (extra: SukuOptions = {}) =>
  Suku.create({ features: [BooksFeature], routes: [graphql()], middlewares: [viewer], ...extra });
const appP = create();

const gql = async (
  q: string,
  options: {
    variables?: unknown;
    headers?: Record<string, string>;
    app?: Awaited<typeof appP>;
  } = {},
) => {
  const app = options.app ?? (await appP);
  const res = await app.handle(
    new Request('http://api.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify({ query: q, variables: options.variables }),
    }),
  );
  return {
    res,
    json: (await res.json()) as { data?: any; errors?: { message: string; extensions?: any }[] },
  };
};

describe('@GraphqlResolver', () => {
  test('constructor injection, queries, nested field resolvers and name overrides', async () => {
    const { json } = await gql('{ books { title author { name } } renamed }');
    expect(json.data).toEqual({
      books: [
        { title: 'Dune', author: { name: 'Frank Herbert' } },
        { title: 'Emma', author: { name: 'Jane Austen' } },
      ],
      renamed: 'ok',
    });
    expect(BooksResolver.instances).toBe(1);
  });

  test('args are validated by the schema and typed in the handler', async () => {
    expect((await gql('{ book(id: "2") { title } }')).json.data).toEqual({
      book: { title: 'Emma' },
    });
    expect((await gql('{ book(id: "404") { title } }')).json.data).toEqual({ book: null });
    const bad = await gql('mutation { addBook(title: "x", authorId: "a1") { id } }');
    expect(bad.json.errors?.[0]).toMatchObject({
      message: 'Invalid arguments for Mutation.addBook',
      extensions: { code: 'BAD_USER_INPUT', issues: [{ path: 'title' }] },
    });
  });

  test('mutations share the service with REST, and can set headers and cookies', async () => {
    const { res, json } = await gql(
      'mutation { addBook(title: "Ulysses", authorId: "a1") { id title } }',
    );
    expect(json.data.addBook).toEqual({ id: '3', title: 'Ulysses' });
    expect(res.headers.get('x-created-book')).toBe('3');
    expect(res.headers.getSetCookie()[0]).toContain('last-book=3');
    const app = await appP;
    const rest = (await (await app.handle(new Request('http://api.test/books'))).json()) as Book[];
    expect(rest.map((b) => b.title)).toContain('Ulysses');
  });

  test('per-resolver services come from the request scope; middleware state reaches resolvers', async () => {
    const a = (await gql('{ loaderId books { author { id } } }')).json.data.loaderId;
    const b = (await gql('{ loaderId }')).json.data.loaderId;
    expect(b).toBe(a + 1);
    expect((await gql('{ me }')).json.data).toEqual({ me: null });
    expect((await gql('{ me }', { headers: { 'x-user': 'ada' } })).json.data).toEqual({
      me: 'ada',
    });
  });

  test('unexpected errors are masked; invalid queries are reported', async () => {
    const crash = await gql('{ crash }');
    expect(crash.json.errors).toHaveLength(1);
    expect(JSON.stringify(crash.json)).not.toContain('db-internal-01');
    expect((await gql('{ nope }')).json.errors?.[0]?.message).toContain(
      'Cannot query field "nope"',
    );
  });

  test('subscriptions yield plain values over server-sent events', async () => {
    const app = await appP;
    const res = await app.handle(
      new Request('http://api.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ query: 'subscription { countdown(from: 2) }' }),
      }),
    );
    const text = await res.text();
    for (const n of [2, 1, 0]) expect(text).toContain(`"countdown":${n}`);
  });

  test('GraphiQL, a custom path, and one route table entry', async () => {
    const app = await appP;
    const page = await app.handle(
      new Request('http://api.test/graphql', { headers: { accept: 'text/html' } }),
    );
    expect(await page.text()).toContain('GraphiQL');
    expect(app.routes.filter((r) => r.name === 'graphql')).toEqual([
      { method: 'ALL', path: '/graphql', name: 'graphql' },
    ]);

    const custom = await Suku.create({
      features: [BooksFeature],
      routes: [graphql({ path: '/api/gql', graphiql: false })],
    });
    const res = await custom.handle(
      new Request('http://api.test/api/gql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"query":"{ renamed }"}',
      }),
    );
    expect(((await res.json()) as any).data).toEqual({ renamed: 'ok' });
    const noIde = await custom.handle(
      new Request('http://api.test/api/gql', { headers: { accept: 'text/html' } }),
    );
    expect(await noIde.text()).not.toContain('GraphiQL');
  });
});

describe('feature-based schemas', () => {
  @GraphqlResolver({ typeDefs: 'extend type Query { ping: String! }' })
  class PingResolver {
    ping = query({ handle: () => 'pong' });
  }
  const PingFeature = feature('ping', { services: [PingResolver] });

  test('only resolvers registered in the app are part of its schema', async () => {
    const both = await Suku.create({ features: [BooksFeature, PingFeature], routes: [graphql()] });
    expect((await gql('{ ping renamed }', { app: both })).json.data).toEqual({
      ping: 'pong',
      renamed: 'ok',
    });
    const pingOnly = await Suku.create({ features: [PingFeature], routes: [graphql()] });
    expect((await gql('{ ping }', { app: pingOnly })).json.data).toEqual({ ping: 'pong' });
    expect((await gql('{ renamed }', { app: pingOnly })).json.errors?.[0]?.message).toContain(
      'Cannot query field "renamed"',
    );
  });

  test('createGraphqlSchema fails fast with clear messages', async () => {
    const empty = await Suku.create({ routes: [graphql()] });
    expect(() => createGraphqlSchema(empty.provider)).toThrow(
      /No GraphQL resolvers are registered/,
    );

    @GraphqlResolver({ typeDefs: 'extend type Query { x: String }' })
    class NoFields {}
    const a = await Suku.create({ services: [NoFields] });
    expect(() => createGraphqlSchema(a.provider)).toThrow(/declares no resolver fields/);

    const Missing = service('missing', () => ({}));
    @GraphqlResolver({ typeDefs: 'extend type Query { y: String }' })
    class NeedsMissing {
      y = query({ services: { m: Missing }, handle: () => 'y' });
    }
    const b = await Suku.create({ services: [NeedsMissing] });
    expect(() => createGraphqlSchema(b.provider)).toThrow(
      /asks for service "m", which is not registered/,
    );

    @GraphqlResolver({ typeDefs: 'extend type Query { z: String }' })
    class Dup1 {
      z = query({ handle: () => '1' });
    }
    @GraphqlResolver({ typeDefs: '' })
    class Dup2 {
      z = query({ handle: () => '2' });
    }
    const c = await Suku.create({ services: [Dup1, Dup2] });
    expect(() => createGraphqlSchema(c.provider)).toThrow(/Query\.z is defined more than once/);

    @GraphqlResolver({ typeDefs: 'extend type Query { w: String }' })
    class NeedsRequest {
      constructor(readonly ctx: RequestContext) {}
      w = query({ handle: () => 'w' });
    }
    const d = await Suku.create({ services: [scoped(NeedsRequest)] });
    expect(() => createGraphqlSchema(d.provider)).toThrow(GraphqlSetupError);
    const main = await appP;
    expect(() => createGraphqlSchema(main.provider)).not.toThrow();
  });

  test('a class may hold only object-type fields, extending a type another class declared', async () => {
    interface Item {
      id: string;
      ownerId: string;
    }
    const ItemType = objectType<Item>('Item');
    @GraphqlResolver({ typeDefs: 'type Item { id: ID! } extend type Query { items: [Item!]! }' })
    class ItemsResolver {
      items = query({ handle: (): Item[] => [{ id: 'i1', ownerId: 'u7' }] });
    }
    @GraphqlResolver({ typeDefs: 'type Owner { id: ID! } extend type Item { owner: Owner! }' })
    class ItemOwnerResolver {
      owner = ItemType.field({ handle: ({ parent }) => ({ id: parent.ownerId }) });
    }
    const app = await Suku.create({
      services: [ItemsResolver, ItemOwnerResolver],
      routes: [graphql()],
    });
    expect((await gql('{ items { id owner { id } } }', { app })).json.data).toEqual({
      items: [{ id: 'i1', owner: { id: 'u7' } }],
    });
  });

  test('a resolver with no matching schema field is reported when the schema is built', async () => {
    @GraphqlResolver({ typeDefs: 'extend type Query { declared: String }' })
    class Mismatch {
      declared = query({ handle: () => 'a' });
      undeclared = query({ handle: () => 'b' });
    }
    const app = await Suku.create({ services: [Mismatch] });
    expect(() => createGraphqlSchema(app.provider)).toThrow(
      /The GraphQL schema is invalid: .*undeclared/,
    );
  });

  test('type-level: args and services are typed; default export matches', () => {
    query({
      args: z.object({ id: z.string() }),
      services: { books: BooksService },
      handle: ({ args, books }) => {
        const id: string = args.id;
        // @ts-expect-error args.id is a string
        const n: number = args.id;
        // @ts-expect-error BooksService has no `nope`
        books.nope;
        return id + n;
      },
    });
    objectType<Book>('Book').field({
      services: { books: BooksService },
      handle: ({ parent }) => {
        // @ts-expect-error Book has no `isbn`
        parent.isbn;
        return parent.title;
      },
    });
    expect(sukuGraphql.GraphqlResolver).toBe(GraphqlResolver);
    expect(sukuGraphql.graphql).toBe(graphql);
  });
});
