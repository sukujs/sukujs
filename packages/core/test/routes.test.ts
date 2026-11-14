import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  FeatureError,
  feature,
  Injectable,
  InjectionToken,
  NotFoundException,
  RequestContext,
  RouteConflictError,
  Routes,
  redirect,
  route,
  Suku,
  scoped,
  singleton,
  value,
} from '../src/index.js';

const req = (path: string, init?: RequestInit) => new Request(`http://t.local${path}`, init);
const json = (path: string, body: unknown, method = 'POST') =>
  req(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

interface User {
  id: number;
  name: string;
}

@Injectable()
class UsersService {
  private readonly users = new Map<number, User>([[1, { id: 1, name: 'Ada' }]]);
  find(id: number) {
    return this.users.get(id);
  }
  list() {
    return [...this.users.values()];
  }
  create(name: string): User {
    const u = { id: this.users.size + 1, name };
    this.users.set(u.id, u);
    return u;
  }
}

const CreateUser = z.object({ name: z.string().min(2) });
const Id = z.object({ id: z.coerce.number().int().positive() });

@Routes('/users')
class UsersRoutes {
  constructor(private readonly users: UsersService) {}

  list = route.get('/', {
    query: z.object({ limit: z.coerce.number().default(10) }),
    handle: ({ query }) => this.users.list().slice(0, query.limit),
  });

  findOne = route.get('/:id', {
    params: Id,
    handle: ({ params }) => {
      const user = this.users.find(params.id);
      if (!user) throw new NotFoundException(`No user ${params.id}`);
      return user;
    },
  });

  create = route.post('/', {
    body: CreateUser,
    handle: ({ body }) => this.users.create(body.name),
  });

  remove = route.delete('/:id', { handle: () => undefined });

  raw = route.get('/:id/raw', {
    handle: ({ params, query, headers, ctx, request }) =>
      `${request.method} ${ctx.route?.name} ${params.id} ${query.q} ${headers.get('x-a')}`,
  });

  notARoute = 'ignored';
}

const UsersFeature = feature('users', {
  routes: [UsersRoutes],
  services: [singleton(UsersService)],
});

describe('class routes', () => {
  const appP = Suku.create({ features: [UsersFeature] });

  test('route table uses Class.field names', async () => {
    const app = await appP;
    expect(app.routes).toContainEqual({
      method: 'GET',
      path: '/users/:id',
      name: 'UsersRoutes.findOne',
    });
    expect(app.routes).toHaveLength(5);
  });

  test('params, query and body are validated and typed by their schemas', async () => {
    const app = await appP;
    expect(await (await app.handle(req('/users/1'))).json()).toEqual({ id: 1, name: 'Ada' });
    expect(await (await app.handle(req('/users?limit=1'))).json()).toEqual([
      { id: 1, name: 'Ada' },
    ]);
    const created = await app.handle(json('/users', { name: 'Grace' }));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: 2, name: 'Grace' });
  });

  test('invalid input is a 400 naming the part and the path', async () => {
    const app = await appP;
    const bad = await app.handle(req('/users/abc'));
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { message: string; issues: { path: string }[] };
    expect(body.message).toBe('Validation failed for params');
    expect(body.issues[0]?.path).toBe('id');
    expect((await app.handle(json('/users', { name: 'x' }))).status).toBe(400);
  });

  test('thrown HttpException, 204 for undefined, raw parts without schemas', async () => {
    const app = await appP;
    const nf = await app.handle(req('/users/9'));
    expect(await nf.json()).toEqual({ statusCode: 404, message: 'No user 9', error: 'Not Found' });
    expect((await app.handle(req('/users/1', { method: 'DELETE' }))).status).toBe(204);
    const raw = await app.handle(req('/users/7/raw?q=hi', { headers: { 'x-a': 'h' } }));
    expect(await raw.text()).toBe('GET UsersRoutes.raw 7 hi h');
  });

  test('404, 405 with Allow, HEAD falls back to GET', async () => {
    const app = await appP;
    expect((await app.handle(req('/nope'))).status).toBe(404);
    const mna = await app.handle(req('/users/1', { method: 'PATCH' }));
    expect(mna.status).toBe(405);
    expect(mna.headers.get('allow')).toBe('DELETE, GET, HEAD');
    expect((await app.handle(req('/users/1', { method: 'HEAD' }))).status).toBe(200);
  });
});

describe('classless routes', () => {
  const CONFIG = new InjectionToken<{ greeting: string }>('CONFIG');

  const hello = route.get('/hello/:name', {
    services: { users: UsersService, config: CONFIG },
    handle: ({ params, users, config }) =>
      `${config.greeting} ${params.name} (${users.list().length})`,
  });

  const admin = route.group('/admin', {
    stats: route.get('/stats', { status: 202, handle: () => ({ ok: true }) }),
    nested: route.group('/deep', {
      go: route.get('/go', { handle: () => redirect('/elsewhere', 301) }),
    }),
    bytes: route.get('/bytes', { handle: () => new Uint8Array([1, 2]) }),
    custom: route.get('/custom', { handle: () => new Response('c', { status: 418 }) }),
  });

  test('declared services arrive typed; groups nest prefixes and names', async () => {
    const app = await Suku.create({
      routes: [hello, admin],
      services: [singleton(UsersService), value(CONFIG, { greeting: 'hi' })],
      prefix: '/api',
    });
    expect(await (await app.handle(req('/api/hello/ada'))).text()).toBe('hi ada (1)');
    expect(app.routes.map((r) => `${r.name} ${r.path}`)).toEqual([
      'GET /api/hello/:name /api/hello/:name',
      'stats /api/admin/stats',
      'nested.go /api/admin/deep/go',
      'bytes /api/admin/bytes',
      'custom /api/admin/custom',
    ]);
    expect((await app.handle(req('/api/admin/stats'))).status).toBe(202);
    const go = await app.handle(req('/api/admin/deep/go'));
    expect(go.status).toBe(301);
    expect(go.headers.get('location')).toBe('/elsewhere');
    expect((await app.handle(req('/api/admin/bytes'))).headers.get('content-type')).toBe(
      'application/octet-stream',
    );
    expect((await app.handle(req('/api/admin/custom'))).status).toBe(418);
    expect((await app.handle(req('/hello/ada'))).status).toBe(404);
  });

  test('response schema validates and strips; a mismatch is a logged 500', async () => {
    const logged: string[] = [];
    const Out = z.object({ id: z.number() });
    const app = await Suku.create({
      routes: [
        route.get('/ok', {
          response: Out,
          handle: () => ({ id: 1, secret: 'x' }) as { id: number },
        }),
        route.get('/bad', {
          response: Out,
          handle: () => ({ id: 'nope' }) as unknown as { id: number },
        }),
      ],
      onError: (e) => {
        logged.push((e as Error).message);
      },
    });
    expect(await (await app.handle(req('/ok'))).json()).toEqual({ id: 1 });
    expect((await app.handle(req('/bad'))).status).toBe(500);
    expect(logged[0]).toContain('does not match its schema');
  });

  test('classes and plain routes mix in one feature', async () => {
    const health = route.get('/health', { handle: () => 'ok' });
    const app = await Suku.create(
      feature('mixed', { routes: [UsersRoutes, health], services: [UsersService] }),
    );
    expect(await (await app.handle(req('/health'))).text()).toBe('ok');
    expect((await app.handle(req('/users/1'))).status).toBe(200);
  });
});

describe('lifetimes', () => {
  let n = 0;
  const disposed: number[] = [];

  @Injectable()
  class Unit {
    readonly id = ++n;
    dispose() {
      disposed.push(this.id);
    }
  }

  @Routes('/scoped', { lifetime: 'scoped' })
  class ScopedRoutes {
    constructor(private readonly unit: Unit) {}
    get = route.get('/', { handle: () => ({ id: this.unit.id }) });
  }

  test('scoped class: fresh instance per request, probe instance at startup, scope disposed', async () => {
    const app = await Suku.create({ routes: [ScopedRoutes], services: [scoped(Unit)] });
    const probeId = n; // constructed once at startup to discover the routes
    const a = (await (await app.handle(req('/scoped'))).json()) as { id: number };
    const b = (await (await app.handle(req('/scoped'))).json()) as { id: number };
    expect(a.id).toBe(probeId + 1);
    expect(b.id).toBe(probeId + 2);
    expect(disposed).toContain(a.id);
    expect(disposed).toContain(b.id);
  });

  test('per-route services give request-scoped values to a singleton class', async () => {
    @Routes('/who')
    class Who {
      get = route.get('/', {
        services: { ctx2: RequestContext, unit: Unit },
        handle: ({ ctx2, unit, ctx }) => ({ same: ctx2 === ctx, unit: typeof unit.id }),
      });
    }
    const app = await Suku.create({ routes: [Who], services: [scoped(Unit)] });
    expect(await (await app.handle(req('/who'))).json()).toEqual({ same: true, unit: 'number' });
  });

  test('a scoped class that needs a live request at construction fails with guidance', async () => {
    @Routes('/x', { lifetime: 'scoped' })
    class NeedsRequest {
      constructor(readonly ctx: RequestContext) {}
      get = route.get('/', { handle: () => 'x' });
    }
    await expect(Suku.create({ routes: [NeedsRequest] })).rejects.toThrow(/services` option/);
  });
});

describe('startup validation', () => {
  test('duplicate routes, empty @Routes classes and non-routes are rejected', async () => {
    const a = route.get('/dup', { handle: () => 1 });
    const b = route.get('/dup/', { handle: () => 2 });
    await expect(Suku.create({ routes: [a, b] })).rejects.toThrow(RouteConflictError);

    @Routes('/empty')
    class Empty {}
    await expect(Suku.create({ routes: [Empty] })).rejects.toThrow(/declares no route fields/);

    class Plain {}
    await expect(Suku.create({ routes: [Plain] })).rejects.toThrow(FeatureError);
    await expect(Suku.create({ features: [{} as never] })).rejects.toThrow(/is not a feature/);
  });

  test('a missing service fails at startup, for classes and for per-route services', async () => {
    @Injectable()
    class Missing {}
    @Routes('/m')
    class Needs {
      constructor(readonly m: Missing) {}
      get = route.get('/', { handle: () => 1 });
    }
    await expect(Suku.create({ routes: [Needs] })).rejects.toThrow(
      /No service registered for Missing/,
    );
  });

  test('features import once, nest by identity, and report cycles', async () => {
    let built = 0;
    @Injectable()
    class Shared {
      constructor() {
        built++;
      }
    }
    const SharedFeature = feature('shared', { services: [singleton(Shared)] });
    const A = feature('a', { imports: [SharedFeature] });
    const B = feature('b', { imports: [SharedFeature, A] });
    const app = await Suku.create({ features: [A, B, SharedFeature] });
    app.get(Shared);
    expect(built).toBe(1);

    const loop: { imports: unknown[] } = { imports: [] };
    const X = feature('x', loop as never);
    const Y = feature('y', { imports: [X] });
    (X.imports as unknown[]).push(Y);
    await expect(Suku.create(X)).rejects.toThrow(/Circular feature import: app -> x -> y -> x/);
  });
});

describe('type-level', () => {
  test('path parameters, schemas and services are checked at compile time', () => {
    route.get('/a/:id', {
      // @ts-expect-error the params schema must cover `id`
      params: z.object({ other: z.string() }),
      handle: () => 1,
    });
    route.get('/a/:id/:slug', {
      handle: ({ params }) => {
        const id: string = params.id;
        const slug: string = params.slug;
        // @ts-expect-error `nope` is not in the path
        params.nope;
        return id + slug;
      },
    });
    route.post('/b', {
      body: z.object({ n: z.number() }),
      services: { users: UsersService },
      handle: ({ body, users }) => {
        const n: number = body.n;
        // @ts-expect-error body.n is a number
        const s: string = body.n;
        users.list();
        // @ts-expect-error UsersService has no `nope`
        users.nope;
        return n + s.length;
      },
    });
    route.get('/c', {
      response: z.object({ id: z.number() }),
      // @ts-expect-error return value must match the response schema
      handle: () => ({ id: 'x' }),
    });
    // @ts-expect-error not an HTTP method
    route.fetch;
    expect(true).toBe(true);
  });
});
