// Every Suku pattern shown on the docs' "Coming from Express" page, run for real.
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  type ErrorHandler,
  feature,
  Logger,
  middleware,
  NotFoundException,
  RouteConflictError,
  redirect,
  route,
  SilentLogger,
  Suku,
  singleton,
  UnauthorizedException,
} from '../src/index';

const req = (path: string, init?: RequestInit) => new Request(`http://t.local${path}`, init);
const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  req(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

interface User {
  id: number;
  name: string;
}

class UsersService {
  private readonly users = new Map<number, User>([[1, { id: 1, name: 'Ada' }]]);
  async find(id: number) {
    return this.users.get(id);
  }
  create(input: { name: string }) {
    return { id: 2, ...input };
  }
}

const verifyToken = async (header: string): Promise<User> => {
  if (header !== 'Bearer good') throw new UnauthorizedException();
  return { id: 1, name: 'Ada' };
};

const requireAuth = middleware(async (ctx, next) => {
  const header = ctx.headers.get('authorization');
  if (!header) throw new UnauthorizedException();
  ctx.set('user', await verifyToken(header));
  return next();
});

describe('an app, translated', () => {
  const findUser = route.get('/users/:id', {
    params: z.object({ id: z.coerce.number().int() }),
    services: { users: UsersService },
    handle: async ({ params, users }) => {
      const user = await users.find(params.id);
      if (!user) throw new NotFoundException('User not found');
      return user;
    },
  });

  const createUser = route.post('/users', {
    body: z.object({ name: z.string().min(1) }),
    middlewares: [requireAuth],
    services: { users: UsersService },
    handle: ({ body, users }) => users.create(body),
  });

  const me = route.get('/me', {
    middlewares: [requireAuth],
    handle: ({ ctx }) => ctx.get<User>('user'),
  });

  const create = () =>
    Suku.create({ routes: [findUser, createUser, me], services: [UsersService] });

  test('finds, 404s and rejects a bad id', async () => {
    const app = await create();
    const found = await app.handle(req('/users/1'));
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ id: 1, name: 'Ada' });
    expect((await app.handle(req('/users/9'))).status).toBe(404);
    const bad = await app.handle(req('/users/abc'));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });

  test('POST validates, authenticates and answers 201', async () => {
    const app = await create();
    expect((await app.handle(json('/users', { name: 'Grace' }))).status).toBe(401);
    const auth = { authorization: 'Bearer good' };
    expect((await app.handle(json('/users', {}, auth))).status).toBe(400);
    const ok = await app.handle(json('/users', { name: 'Grace' }, auth));
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ id: 2, name: 'Grace' });
  });

  test('a middleware shares state with the handler', async () => {
    const app = await create();
    const res = await app.handle(req('/me', { headers: { authorization: 'Bearer good' } }));
    expect(await res.json()).toEqual({ id: 1, name: 'Ada' });
  });

  test('the wrong method is a 405 with Allow', async () => {
    const app = await create();
    const res = await app.handle(req('/me', { method: 'DELETE' }));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('GET');
  });
});

describe('the response', () => {
  const reports = { find: async (id: string) => (id === '1' ? { id } : undefined) };
  const routes = [
    route.get('/reports/:id', {
      handle: async ({ params, ctx }) => {
        const report = await reports.find(params.id);
        if (!report) throw new NotFoundException();
        ctx.setHeader('cache-control', 'private, max-age=60');
        return report;
      },
    }),
    route.get('/text', { handle: () => 'text' }),
    route.get('/nothing', { handle: () => {} }),
    route.post('/jobs', { status: 202, handle: () => ({ queued: true }) }),
    route.get('/runtime', { handle: () => Response.json({ ok: true }, { status: 206 }) }),
    route.get('/old', { handle: () => redirect('/new', 301) }),
    route.get('/login', { handle: () => redirect('/login') }),
    route.post('/session', {
      status: 200,
      handle: ({ ctx }) => {
        ctx.cookies.set('session', 'abc');
        return { ok: true };
      },
    }),
    route.post('/logout', {
      handle: ({ ctx }) => {
        ctx.cookies.delete('session');
      },
    }),
    route.get('/files/*path', { handle: ({ params }) => ({ path: params.path }) }),
    route.get('/search', { handle: ({ query }) => query }),
  ];
  const create = () => Suku.create({ routes });

  test('return values, status and headers', async () => {
    const app = await create();
    const report = await app.handle(req('/reports/1'));
    expect(report.headers.get('cache-control')).toBe('private, max-age=60');
    expect(await report.json()).toEqual({ id: '1' });
    expect((await app.handle(req('/reports/2'))).status).toBe(404);

    const text = await app.handle(req('/text'));
    expect(text.headers.get('content-type')).toContain('text/plain');
    expect((await app.handle(req('/nothing'))).status).toBe(204);
    expect((await app.handle(req('/jobs', { method: 'POST' }))).status).toBe(202);
    expect((await app.handle(req('/runtime'))).status).toBe(206);
  });

  test('redirects', async () => {
    const app = await create();
    const moved = await app.handle(req('/old'));
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe('/new');
    expect((await app.handle(req('/login'))).status).toBe(302);
  });

  test('cookies are HttpOnly, Secure and SameSite=Lax by default', async () => {
    const app = await create();
    const set = (await app.handle(req('/session', { method: 'POST' }))).headers.get('set-cookie');
    expect(set).toContain('session=abc');
    expect(set).toContain('HttpOnly');
    expect(set).toContain('Secure');
    expect(set).toContain('SameSite=Lax');
    const cleared = await app.handle(req('/logout', { method: 'POST' }));
    expect(cleared.status).toBe(204);
    expect(cleared.headers.get('set-cookie')).toContain('session=');
  });

  test('a wildcard is one string, and query strings stay flat', async () => {
    const app = await create();
    expect(await (await app.handle(req('/files/a/b/c'))).json()).toEqual({ path: 'a/b/c' });
    expect(await (await app.handle(req('/search?tag=a&tag=b'))).json()).toEqual({
      tag: ['a', 'b'],
    });
    expect(await (await app.handle(req('/search?filter[status]=open'))).json()).toEqual({
      'filter[status]': 'open',
    });
  });
});

describe('middleware and routers', () => {
  const timing = middleware(async (_ctx, next) => {
    const started = performance.now();
    const res = await next();
    res.headers.set('server-timing', `app;dur=${(performance.now() - started).toFixed(1)}`);
    return res;
  });

  const requireAdmin = middleware((ctx, next) => {
    if (ctx.headers.get('x-role') !== 'admin') throw new UnauthorizedException();
    return next();
  });

  const admin = route.group(
    '/admin',
    { middlewares: [requireAdmin] },
    {
      stats: route.get('/stats', { handle: () => ({ users: 1 }) }),
      purge: route.post('/purge', { status: 200, handle: () => ({ purged: 0 }) }),
    },
  );

  test('code after next() runs on the way out, for unmatched paths too', async () => {
    const app = await Suku.create({ routes: [admin], middlewares: [timing] });
    const res = await app.handle(req('/nope'));
    expect(res.status).toBe(404);
    expect(res.headers.get('server-timing')).toStartWith('app;dur=');
  });

  test('app.use adds a middleware after creation', async () => {
    const app = await Suku.create({ routes: [admin] });
    app.use(timing);
    const res = await app.handle(req('/admin/stats', { headers: { 'x-role': 'admin' } }));
    expect(res.headers.get('server-timing')).toStartWith('app;dur=');
  });

  test('a group shares a prefix and middlewares', async () => {
    const app = await Suku.create({ routes: [admin] });
    expect((await app.handle(req('/admin/stats'))).status).toBe(401);
    const admins = { headers: { 'x-role': 'admin' } };
    expect(await (await app.handle(req('/admin/stats', admins))).json()).toEqual({ users: 1 });
    const purge = await app.handle(req('/admin/purge', { method: 'POST', ...admins }));
    expect(purge.status).toBe(200);
  });

  test('a feature mounts routes under a prefix with services and middlewares', async () => {
    const findOne = route.get('/:id', {
      params: z.object({ id: z.coerce.number().int() }),
      services: { users: UsersService },
      handle: ({ params, users }) => users.find(params.id),
    });
    const create = route.post('/', {
      body: z.object({ name: z.string().min(1) }),
      services: { users: UsersService },
      handle: ({ body, users }) => users.create(body),
    });
    const UsersFeature = feature('users', {
      prefix: '/users',
      routes: [findOne, create],
      services: [UsersService],
      middlewares: [requireAuth],
    });
    const app = await Suku.create({ features: [UsersFeature] });
    expect((await app.handle(req('/users/1'))).status).toBe(401);
    const auth = { authorization: 'Bearer good' };
    expect((await app.handle(req('/users/1', { headers: auth }))).status).toBe(200);
    expect((await app.handle(json('/users', { name: 'Grace' }, auth))).status).toBe(201);
  });

  test('static segments win whatever the order, and duplicates are rejected', async () => {
    const app = await Suku.create({
      routes: [
        route.get('/users/:id', { handle: ({ params }) => params.id }),
        route.get('/users/me', { handle: () => 'me' }),
      ],
    });
    expect(await (await app.handle(req('/users/me'))).text()).toBe('me');
    expect(
      Suku.create({
        routes: [route.get('/a', { handle: () => 1 }), route.get('/a', { handle: () => 2 })],
      }),
    ).rejects.toBeInstanceOf(RouteConflictError);
  });
});

describe('errors', () => {
  class InsufficientFunds extends Error {}

  const domainErrors: ErrorHandler = (error) => {
    if (error instanceof InsufficientFunds) {
      return Response.json({ code: 'insufficient_funds' }, { status: 422 });
    }
  };

  test('onError maps a domain error; anything else is a silent 500', async () => {
    const app = await Suku.create({
      routes: [
        route.post('/pay', {
          handle: async () => {
            throw new InsufficientFunds();
          },
        }),
        route.get('/bug', {
          handle: async () => {
            throw new Error('connect ECONNREFUSED db.internal:5432');
          },
        }),
      ],
      services: [singleton(Logger, SilentLogger)],
      onError: domainErrors,
    });
    const mapped = await app.handle(req('/pay', { method: 'POST' }));
    expect(mapped.status).toBe(422);
    expect(await mapped.json()).toEqual({ code: 'insufficient_funds' });
    const bug = await app.handle(req('/bug'));
    expect(bug.status).toBe(500);
    expect(await bug.text()).not.toContain('ECONNREFUSED');
  });
});

describe('validation, services and testing', () => {
  class Database {
    orders = { all: () => [{ id: 1 }] };
  }

  class OrdersService {
    static inject = [Database];
    constructor(private readonly db: Database) {}
    all() {
      return this.db.orders.all();
    }
  }

  test('the body schema validates and the service is injected', async () => {
    const users = {
      create: (input: { email: string; age?: number | undefined }) => ({ id: 1, ...input }),
    };
    const app = await Suku.create({
      routes: [
        route.post('/users', {
          body: z.object({ email: z.email(), age: z.number().int().min(0).optional() }),
          handle: ({ body }) => users.create(body),
        }),
        route.get('/orders', {
          services: { orders: OrdersService },
          handle: ({ orders }) => orders.all(),
        }),
      ],
      services: [Database, OrdersService],
    });
    expect((await app.handle(json('/users', { email: 'nope' }))).status).toBe(400);
    expect((await app.handle(json('/users', { email: 'a@b.co', age: 3 }))).status).toBe(201);
    expect(await (await app.handle(req('/orders'))).json()).toEqual([{ id: 1 }]);
  });
});
