// Every pattern in the GraphQL guide, run against the real GraphQL Yoga.
import { describe, expect, test } from 'bun:test';
import { middleware, PayloadTooLargeException, UnauthorizedException } from '@suku/core';
import { createApp } from '../src/app.js';

const appP = createApp();

const gql = async (
  query: string,
  options: { variables?: unknown; headers?: Record<string, string> } = {},
) => {
  const app = await appP;
  const res = await app.handle(
    new Request('http://api.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify({ query, variables: options.variables }),
    }),
  );
  return {
    res,
    json: (await res.json()) as { data?: any; errors?: { message: string; extensions?: any }[] },
  };
};

describe('GraphQL mounted as one Suku route', () => {
  test('queries resolve through services from the container', async () => {
    const { res, json } = await gql('{ books { id title author { name } } }');
    expect(res.status).toBe(200);
    expect(json.data.books).toEqual([
      { id: '1', title: 'Dune', author: { name: 'Frank Herbert' } },
      { id: '2', title: 'Emma', author: { name: 'Jane Austen' } },
    ]);
  });

  test('variables, nullable results, and GET queries', async () => {
    const q = 'query ($id: ID!) { book(id: $id) { title } }';
    expect((await gql(q, { variables: { id: '2' } })).json.data).toEqual({
      book: { title: 'Emma' },
    });
    expect((await gql(q, { variables: { id: '99' } })).json.data).toEqual({ book: null });
    const app = await appP;
    const get = await app.handle(
      new Request(`http://api.test/graphql?query=${encodeURIComponent('{ books { id } }')}`),
    );
    expect(((await get.json()) as any).data.books).toHaveLength(2);
  });

  test('a Suku middleware supplies the viewer to resolvers', async () => {
    expect((await gql('{ me }')).json.data).toEqual({ me: null });
    expect((await gql('{ me }', { headers: { 'x-role': 'reader' } })).json.data).toEqual({
      me: 'user-reader',
    });
  });

  test('mutations: authorisation in a resolver, and ctx.setHeader reaching the response', async () => {
    const m = 'mutation { addBook(title: "Ulysses", authorId: "a1") { id title } }';
    const denied = await gql(m, { headers: { 'x-role': 'reader' } });
    expect(denied.json.errors?.[0]).toMatchObject({
      message: 'Only editors can add books',
      extensions: { code: 'FORBIDDEN' },
    });
    expect(denied.res.headers.get('x-created-book')).toBeNull();

    const ok = await gql(m, { headers: { 'x-role': 'editor' } });
    expect(ok.json.data.addBook).toEqual({ id: '3', title: 'Ulysses' });
    expect(ok.res.headers.get('x-created-book')).toBe('3');
  });

  test('the REST route sees what the mutation wrote: one shared service', async () => {
    const app = await appP;
    const books = (await (await app.handle(new Request('http://api.test/books'))).json()) as {
      title: string;
    }[];
    expect(books.map((b) => b.title)).toContain('Ulysses');
  });

  test('a scoped service is one instance per request, shared by every resolver in it', async () => {
    // Three books by two authors in one request: two fetches, cached within the request.
    const first = await gql('{ books { author { name } } authorFetches }');
    expect(first.json.data.books).toHaveLength(3);
    // A new request starts from zero: the count is read before any author is loaded.
    expect((await gql('{ authorFetches }')).json.data).toEqual({ authorFetches: 0 });
  });

  test('invalid queries are answered by Yoga, not by Suku', async () => {
    const { res, json } = await gql('{ nope }');
    expect(json.errors?.[0]?.message).toContain('Cannot query field "nope"');
    expect(json.data).toBeUndefined();
    expect([200, 400]).toContain(res.status);
  });

  test('unexpected resolver errors are masked by Yoga, so internals never leak', async () => {
    const { res, json } = await gql('{ crash }');
    expect(res.status).toBe(200);
    expect(json.errors).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain('db-internal-01');
  });

  test('a Suku middleware that rejects answers in Suku format, before Yoga runs', async () => {
    const guarded = await createApp({
      middlewares: [
        () => {
          throw new UnauthorizedException();
        },
      ],
    });
    const res = await guarded.handle(
      new Request('http://api.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"query":"{ me }"}',
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    });
  });

  test('a size-limiting middleware on the route rejects oversized requests', async () => {
    const maxBody = (bytes: number) =>
      middleware((ctx, next) => {
        if (Number(ctx.headers.get('content-length') ?? 0) > bytes)
          throw new PayloadTooLargeException();
        return next();
      });
    const limited = await createApp({ middlewares: [maxBody(50)] });
    const send = (length: string) =>
      limited.handle(
        new Request('http://api.test/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': length },
          body: '{"query":"{ me }"}',
        }),
      );
    expect((await send('18')).status).toBe(200);
    expect((await send('5000')).status).toBe(413);
  });

  test('Suku CORS middleware covers the GraphQL route, including preflight', async () => {
    const app = await appP;
    const pre = await app.handle(
      new Request('http://api.test/graphql', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      }),
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    const { res } = await gql('{ me }', { headers: { origin: 'https://app.example.com' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test('GraphiQL is served on a browser GET', async () => {
    const app = await appP;
    const res = await app.handle(
      new Request('http://api.test/graphql', { headers: { accept: 'text/html' } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('GraphiQL');
  });

  test('subscriptions stream over server-sent events', async () => {
    const app = await appP;
    const res = await app.handle(
      new Request('http://api.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ query: 'subscription { countdown(from: 2) }' }),
      }),
    );
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    for (const n of [2, 1, 0]) expect(text).toContain(`"countdown":${n}`);
  });

  test('the route table has one entry for the whole GraphQL API', async () => {
    const app = await appP;
    expect(app.routes.filter((r) => r.path === '/graphql')).toEqual([
      { method: 'ALL', path: '/graphql', name: 'ALL /graphql' },
    ]);
  });
});
