// Every pattern shown on the docs' Handlers page, run for real.
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
  parseCookies,
  redirect,
  route,
  SilentLogger,
  Suku,
  serializeCookie,
  singleton,
  TooManyRequestsException,
} from '../src/index.js';

const req = (path: string, init?: RequestInit) => new Request(`http://t.local${path}`, init);

describe('cookies', () => {
  const routes = [
    route.get('/read', {
      handle: ({ ctx }) => ({
        theme: ctx.cookies.get('theme') ?? null,
        has: ctx.cookies.has('sid'),
        all: ctx.cookies.all(),
      }),
    }),
    route.post('/login', {
      status: 200,
      handle: ({ ctx }) => {
        ctx.cookies.set('sid', 'abc 123', { maxAge: 3600 });
        ctx.cookies.set('theme', 'dark', {
          httpOnly: false,
          sameSite: 'Strict',
          secure: false,
          path: '/app',
          domain: 'example.com',
        });
        return { ok: true };
      },
    }),
    route.post('/logout', {
      handle: ({ ctx }) => {
        ctx.cookies.delete('sid');
      },
    }),
    route.get('/with-response', {
      handle: ({ ctx }) => {
        ctx.cookies.set('a', '1');
        return new Response('custom', { headers: { 'set-cookie': 'own=1' } });
      },
    }),
    route.get('/boom', {
      handle: ({ ctx }) => {
        ctx.cookies.set('seen', '1');
        throw new NotFoundException();
      },
    }),
    route.get('/go', {
      handle: ({ ctx }) => {
        ctx.cookies.set('flash', 'saved');
        return Response.redirect('http://t.local/read', 302);
      },
    }),
  ];
  const appP = Suku.create({ routes });

  test('reading: get, has, all, with decoding and quoted values', async () => {
    const app = await appP;
    const res = await app.handle(
      req('/read', { headers: { cookie: 'theme=dark; sid=a%20b; q="quoted"; bad' } }),
    );
    expect(await res.json()).toEqual({
      theme: 'dark',
      has: true,
      all: { theme: 'dark', sid: 'a b', q: 'quoted' },
    });
    expect(await (await app.handle(req('/read'))).json()).toEqual({
      theme: null,
      has: false,
      all: {},
    });
  });

  test('setting: safe defaults, options, and several cookies at once', async () => {
    const app = await appP;
    const res = await app.handle(req('/login', { method: 'POST' }));
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.getSetCookie()).toEqual([
      'sid=abc%20123; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax',
      'theme=dark; Path=/app; Domain=example.com; SameSite=Strict',
    ]);
  });

  test('deleting, even on a 204', async () => {
    const app = await appP;
    const res = await app.handle(req('/logout', { method: 'POST' }));
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()).toEqual([
      'sid=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
    ]);
  });

  test('cookies survive a returned Response, an error, and an immutable redirect', async () => {
    const app = await appP;
    expect((await app.handle(req('/with-response'))).headers.getSetCookie()).toEqual([
      'own=1',
      'a=1; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);
    const boom = await app.handle(req('/boom'));
    expect(boom.status).toBe(404);
    expect(boom.headers.getSetCookie()).toHaveLength(1);
    const go = await app.handle(req('/go'));
    expect(go.status).toBe(302);
    expect(go.headers.get('location')).toBe('http://t.local/read');
    expect(go.headers.getSetCookie()[0]).toContain('flash=saved');
  });

  test('invalid names and insecure SameSite=None are refused', () => {
    expect(() => serializeCookie('bad name', 'x')).toThrow(/Invalid cookie name/);
    expect(() => serializeCookie('a', 'x', { sameSite: 'None', secure: false })).toThrow(
      /must also be Secure/,
    );
    expect(serializeCookie('a', 'x', { sameSite: 'None', partitioned: true })).toBe(
      'a=x; Path=/; HttpOnly; Secure; SameSite=None; Partitioned',
    );
    expect(parseCookies('a=1; a=2; b=%E0%A4%A')).toEqual({ a: '1', b: '%E0%A4%A' });
  });
});

describe('response headers and status', () => {
  test('ctx.setHeader applies to plain data; a returned Response wins; middlewares can set them too', async () => {
    const app = await Suku.create({
      routes: [
        route.get('/data', {
          handle: ({ ctx }) => {
            ctx.setHeader('cache-control', 'max-age=60').setHeader('x-total-count', '42');
            return [1, 2];
          },
        }),
        route.get('/explicit', {
          handle: ({ ctx }) => {
            ctx.setHeader('cache-control', 'max-age=60');
            return new Response('x', { headers: { 'cache-control': 'no-store' } });
          },
        }),
        route.post('/jobs', { status: 202, handle: () => ({ queued: true }) }),
        route.get('/old', { handle: () => redirect('/new', 301) }),
      ],
      middlewares: [
        (ctx, next) => {
          ctx.setHeader('x-request-id', 'r1');
          return next();
        },
      ],
    });
    const data = await app.handle(req('/data'));
    expect([
      data.headers.get('cache-control'),
      data.headers.get('x-total-count'),
      data.headers.get('x-request-id'),
    ]).toEqual(['max-age=60', '42', 'r1']);
    expect((await app.handle(req('/explicit'))).headers.get('cache-control')).toBe('no-store');
    expect((await app.handle(req('/jobs', { method: 'POST' }))).status).toBe(202);
    const old = await app.handle(req('/old'));
    expect([old.status, old.headers.get('location'), old.headers.get('x-request-id')]).toEqual([
      301,
      '/new',
      'r1',
    ]);
    expect((await app.handle(req('/missing'))).headers.get('x-request-id')).toBe('r1');
  });
});

describe('bodies in and out', () => {
  const appP = Suku.create({
    routes: [
      route.post('/upload', {
        handle: async ({ ctx }) => {
          const form = await ctx.body<FormData>();
          const file = form.get('file') as File;
          return { name: file.name, type: file.type, size: file.size, title: form.get('title') };
        },
      }),
      route.post('/raw', {
        handle: async ({ request }) => ({ bytes: (await request.arrayBuffer()).byteLength }),
      }),
      route.get('/download', {
        handle: () =>
          new Response('id,name\n1,Ada\n', {
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': 'attachment; filename="users.csv"',
            },
          }),
      }),
      route.get('/stream', {
        handle: () => {
          const encoder = new TextEncoder();
          return new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of ['a', 'b', 'c']) controller.enqueue(encoder.encode(chunk));
              controller.close();
            },
          });
        },
      }),
      route.get('/events', {
        handle: () => {
          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              for (const n of [1, 2])
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ n })}\n\n`));
              controller.close();
            },
          });
          return new Response(stream, {
            headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
          });
        },
      }),
      route.get('/search', {
        query: z.object({
          tag: z
            .union([z.string(), z.array(z.string())])
            .transform((v) => (Array.isArray(v) ? v : [v])),
        }),
        handle: ({ query, headers, ctx }) => ({
          tags: query.tag,
          lang: headers.get('accept-language'),
          host: ctx.url.host,
          ip: ctx.remoteAddress ?? null,
        }),
      }),
    ],
  });

  test('multipart upload, raw bytes', async () => {
    const app = await appP;
    const form = new FormData();
    form.set('title', 'Report');
    form.set('file', new File(['hello'], 'r.txt', { type: 'text/plain' }));
    const up = (await (
      await app.handle(req('/upload', { method: 'POST', body: form }))
    ).json()) as { type: string };
    expect(up).toMatchObject({ name: 'r.txt', size: 5, title: 'Report' });
    expect(up.type).toContain('text/plain');
    const raw = await app.handle(req('/raw', { method: 'POST', body: new Uint8Array([1, 2, 3]) }));
    expect(await raw.json()).toEqual({ bytes: 3 });
  });

  test('downloads, streams and server-sent events', async () => {
    const app = await appP;
    const dl = await app.handle(req('/download'));
    expect(dl.headers.get('content-disposition')).toBe('attachment; filename="users.csv"');
    expect(await dl.text()).toBe('id,name\n1,Ada\n');
    expect(await (await app.handle(req('/stream'))).text()).toBe('abc');
    const sse = await app.handle(req('/events'));
    expect(sse.headers.get('content-type')).toBe('text/event-stream');
    expect(await sse.text()).toBe('data: {"n":1}\n\ndata: {"n":2}\n\n');
  });

  test('repeated query keys, request headers, url and address', async () => {
    const app = await appP;
    const res = await app.handle(
      req('/search?tag=a&tag=b', { headers: { 'accept-language': 'en' } }),
      { remoteAddress: '203.0.113.5' },
    );
    expect(await res.json()).toEqual({
      tags: ['a', 'b'],
      lang: 'en',
      host: 't.local',
      ip: '203.0.113.5',
    });
    expect(
      ((await (await app.handle(req('/search?tag=a'))).json()) as { tags: string[] }).tags,
    ).toEqual(['a']);
  });
});

// The patterns shown on the docs' Errors page.
describe('status codes and exceptions', () => {
  class PaymentRequiredException extends HttpException {
    constructor(message = 'Payment required') {
      super(402, message);
    }
  }
  class QuotaExceededException extends HttpException {
    constructor(
      readonly limit: number,
      readonly retryAfter: number,
    ) {
      super(
        429,
        { code: 'quota_exceeded', limit },
        { headers: { 'retry-after': String(retryAfter) } },
      );
    }
  }
  class InsufficientFunds extends Error {
    constructor(readonly missing: number) {
      super('Insufficient funds');
    }
  }
  class NotAHttpError extends Error {}

  const appP = Suku.create({
    services: [singleton(Logger, SilentLogger)],
    onError: (error) => {
      if (error instanceof InsufficientFunds) {
        return Response.json(
          { code: 'insufficient_funds', missing: error.missing },
          { status: 422 },
        );
      }
    },
    routes: [
      route.post('/jobs', { status: 202, handle: () => ({ queued: true }) }),
      route.put('/items/:id', {
        handle: ({ params }) =>
          Response.json({ id: params.id }, { status: params.id === 'new' ? 201 : 200 }),
      }),
      route.get('/throw/:kind', {
        handle: ({ params }) => {
          switch (params.kind) {
            case 'plain':
              throw new HttpException(402, 'Subscription required');
            case 'default':
              throw new NotFoundException();
            case 'object':
              throw new ConflictException({ code: 'email_taken', field: 'email' });
            case 'headers':
              throw new TooManyRequestsException('Slow down', { headers: { 'retry-after': '30' } });
            case 'custom':
              throw new PaymentRequiredException();
            case 'shaped':
              throw new QuotaExceededException(100, 60);
            case 'domain':
              throw new InsufficientFunds(25);
            case 'teapot':
              throw new HttpException(418);
            case 'unknown-code':
              throw new HttpException(499, 'Client closed');
            default:
              throw new NotAHttpError('secret detail');
          }
        },
      }),
    ],
  });
  const get = async (path: string) => {
    const res = await (await appP).handle(req(path));
    return { status: res.status, body: await res.json(), headers: res.headers };
  };

  test('success statuses: route option and returned Response', async () => {
    const app = await appP;
    expect((await app.handle(req('/jobs', { method: 'POST' }))).status).toBe(202);
    expect((await app.handle(req('/items/new', { method: 'PUT' }))).status).toBe(201);
    expect((await app.handle(req('/items/7', { method: 'PUT' }))).status).toBe(200);
  });

  test('HttpException with any status, default messages, object bodies and headers', async () => {
    expect(await get('/throw/plain')).toMatchObject({
      status: 402,
      body: { statusCode: 402, message: 'Subscription required', error: 'Payment Required' },
    });
    expect((await get('/throw/default')).body).toEqual({
      statusCode: 404,
      message: 'Not Found',
      error: 'Not Found',
    });
    expect(await get('/throw/object')).toMatchObject({
      status: 409,
      body: { code: 'email_taken', field: 'email' },
    });
    const limited = await get('/throw/headers');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('30');
    expect((await get('/throw/teapot')).body).toEqual({
      statusCode: 418,
      message: "I'm a teapot",
      error: "I'm a teapot",
    });
    expect((await get('/throw/unknown-code')).body).toEqual({
      statusCode: 499,
      message: 'Client closed',
      error: 'HTTP 499',
    });
  });

  test('custom classes: a new status, a custom shape, and a domain error mapped by onError', async () => {
    expect(await get('/throw/custom')).toMatchObject({
      status: 402,
      body: { statusCode: 402, message: 'Payment required', error: 'Payment Required' },
    });
    const quota = await get('/throw/shaped');
    expect(quota).toMatchObject({ status: 429, body: { code: 'quota_exceeded', limit: 100 } });
    expect(quota.headers.get('retry-after')).toBe('60');
    expect(await get('/throw/domain')).toMatchObject({
      status: 422,
      body: { code: 'insufficient_funds', missing: 25 },
    });
  });

  test('anything else is a 500 that reveals nothing; exceptions expose status and body', async () => {
    expect(await get('/throw/other')).toMatchObject({
      status: 500,
      body: { statusCode: 500, message: 'Internal Server Error', error: 'Internal Server Error' },
    });
    const e = new QuotaExceededException(5, 10);
    expect([e instanceof HttpException, e.status, e.limit, e.getBody()]).toEqual([
      true,
      429,
      5,
      { code: 'quota_exceeded', limit: 5 },
    ]);
    expect(new ForbiddenException('No').getBody()).toEqual({
      statusCode: 403,
      message: 'No',
      error: 'Forbidden',
    });
    // The Error message never becomes the text "undefined" for object bodies.
    expect(new ConflictException({ code: 'email_taken' }).message).toBe('Conflict');
    expect(new ConflictException({ code: 'x', message: 'Already used' }).message).toBe(
      'Already used',
    );
    expect(new NotFoundException().message).toBe('Not Found');
  });
});
