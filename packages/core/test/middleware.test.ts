import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  allow,
  ConfigError,
  ConsoleLogger,
  defineConfig,
  type ErrorHandler,
  feature,
  type Infer,
  Inject,
  Logger,
  type Middleware,
  type MiddlewareFn,
  middleware,
  type Next,
  RequestContext,
  Routes,
  route,
  Service,
  SilentLogger,
  Suku,
  singleton,
  UnauthorizedException,
} from '../src/index.js';

const req = (path: string, init?: RequestInit) => new Request(`http://t.local${path}`, init);
const json = (path: string, body: unknown) =>
  req(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const log: string[] = [];
const tag = (name: string): MiddlewareFn =>
  middleware(async (_ctx, next) => {
    log.push(`${name}:in`);
    const res = await next();
    log.push(`${name}:out`);
    return res;
  });

describe('middlewares', () => {
  test('order is app, feature, class or group, route; and unwinds in reverse', async () => {
    @Routes('/c', { middlewares: [tag('class')] })
    class C {
      get = route.get('/', {
        middlewares: [tag('route')],
        handle: () => {
          log.push('handler');
          return 'ok';
        },
      });
    }
    const grouped = route.group(
      '/g',
      { middlewares: [tag('group')] },
      {
        get: route.get('/', { middlewares: [tag('route')], handle: () => 'ok' }),
      },
    );
    const app = await Suku.create({
      features: [feature('f', { routes: [C, grouped], middlewares: [tag('feature')] })],
      middlewares: [tag('app')],
    });
    log.length = 0;
    await app.handle(req('/c'));
    expect(log).toEqual([
      'app:in',
      'feature:in',
      'class:in',
      'route:in',
      'handler',
      'route:out',
      'class:out',
      'feature:out',
      'app:out',
    ]);
    log.length = 0;
    await app.handle(req('/g'));
    expect(log).toEqual([
      'app:in',
      'feature:in',
      'group:in',
      'route:in',
      'route:out',
      'group:out',
      'feature:out',
      'app:out',
    ]);
  });

  test('see every response including 404s, can short-circuit, and feature middlewares stay in their feature', async () => {
    const seen: string[] = [];
    const a = feature('a', {
      routes: [route.get('/a', { handle: () => 'a' })],
      middlewares: [tag('a')],
    });
    const b = feature('b', { routes: [route.get('/b', { handle: () => 'b' })] });
    const app = await Suku.create({ features: [a, b] });
    app.use(async (ctx, next) => {
      if (ctx.url.pathname === '/blocked') return new Response('no', { status: 418 });
      const res = await next();
      seen.push(`${ctx.url.pathname} ${res.status} ${ctx.route?.name}`);
      res.headers.set('x-mw', '1');
      return res;
    });
    log.length = 0;
    expect((await app.handle(req('/b'))).headers.get('x-mw')).toBe('1');
    expect(log).toEqual([]);
    await app.handle(req('/a'));
    expect(log).toEqual(['a:in', 'a:out']);
    const nf = await app.handle(req('/missing'));
    expect(nf.status).toBe(404);
    expect(nf.headers.get('x-mw')).toBe('1');
    expect((await app.handle(req('/blocked'))).status).toBe(418);
    expect(seen).toEqual(['/b 200 GET /b', '/a 200 GET /a', '/missing 404 undefined']);
  });

  test('class middlewares are injected without registration; scoped ones get the request context', async () => {
    let built = 0;
    @Service()
    class Counter {
      n = 0;
    }
    @Service()
    class Counting implements Middleware {
      constructor(private readonly counter: Counter) {
        built++;
      }
      async use(_ctx: RequestContext, next: Next) {
        this.counter.n++;
        return next();
      }
    }
    @Service({ lifetime: 'scoped' })
    class Auth implements Middleware {
      constructor(private readonly ctx: RequestContext) {}
      async use(_ctx: RequestContext, next: Next) {
        const token = this.ctx.headers.get('authorization');
        if (!token) throw new UnauthorizedException();
        this.ctx.set('user', { name: token });
        return next();
      }
    }
    const app = await Suku.create({
      routes: [
        route.get('/me', {
          middlewares: [Auth, allow((ctx) => ctx.get<{ name: string }>('user')?.name !== 'banned')],
          meta: { audit: true },
          handle: ({ ctx }) => ({ user: ctx.get('user'), audit: ctx.route?.meta.audit }),
        }),
      ],
      services: [singleton(Counter)],
      middlewares: [Counting],
    });
    expect((await app.handle(req('/me'))).status).toBe(401);
    expect(
      await (await app.handle(req('/me', { headers: { authorization: 'ada' } }))).json(),
    ).toEqual({
      user: { name: 'ada' },
      audit: true,
    });
    expect((await app.handle(req('/me', { headers: { authorization: 'banned' } }))).status).toBe(
      403,
    );
    expect(app.get(Counter).n).toBe(3);
    expect(built).toBe(1);
  });

  test('calling next() twice is an error', async () => {
    const app = await Suku.create({
      routes: [route.get('/', { handle: () => 'x' })],
      services: [singleton(Logger, SilentLogger)],
      middlewares: [
        async (_ctx, next) => {
          await next();
          return next();
        },
      ],
    });
    expect((await app.handle(req('/'))).status).toBe(500);
  });
});

describe('onError', () => {
  class DomainError extends Error {}
  const calls: string[] = [];
  const handler =
    (name: string, status?: number): ErrorHandler =>
    (error) => {
      calls.push(name);
      return status && error instanceof DomainError ? new Response(name, { status }) : undefined;
    };

  test('most specific first: route, class, feature, app; then the default', async () => {
    @Routes('/e', { onError: handler('class') })
    class E {
      a = route.get('/a', {
        onError: handler('route', 422),
        handle: () => {
          throw new DomainError();
        },
      });
      b = route.get('/b', {
        onError: handler('route'),
        handle: () => {
          throw new DomainError();
        },
      });
      c = route.get('/c', {
        handle: () => {
          throw new Error('plain');
        },
      });
    }
    const logged: unknown[] = [];
    class Capture extends Logger {
      log(_l: string, message: string, meta?: Record<string, unknown>) {
        logged.push({ message, path: meta?.path });
      }
    }
    const app = await Suku.create({
      features: [feature('f', { routes: [E], onError: handler('feature', 409) })],
      services: [singleton(Logger, Capture)],
      onError: handler('app'),
    });
    calls.length = 0;
    expect((await app.handle(req('/e/a'))).status).toBe(422);
    expect(calls).toEqual(['route']);
    calls.length = 0;
    expect((await app.handle(req('/e/b'))).status).toBe(409);
    expect(calls).toEqual(['route', 'class', 'feature']);
    calls.length = 0;
    expect((await app.handle(req('/e/c'))).status).toBe(500);
    expect(calls).toEqual(['class', 'feature', 'app']);
    expect(logged).toEqual([{ message: 'plain', path: '/e/c' }]);
    calls.length = 0;
    expect((await app.handle(req('/nowhere'))).status).toBe(404);
    expect(calls).toEqual(['app']);
  });

  test('a throwing handler yields a logged 500; middleware errors reach the app handler', async () => {
    const app = await Suku.create({
      routes: [
        route.get('/x', {
          onError: () => {
            throw new Error('handler broke');
          },
          handle: () => {
            throw new DomainError();
          },
        }),
        route.get('/y', { handle: () => 'y' }),
      ],
      services: [singleton(Logger, SilentLogger)],
      middlewares: [
        async (ctx, next) => {
          if (ctx.url.pathname === '/y') throw new DomainError();
          return next();
        },
      ],
      onError: (e) =>
        e instanceof DomainError ? new Response('mapped', { status: 422 }) : undefined,
    });
    expect((await app.handle(req('/x'))).status).toBe(500);
    expect(await (await app.handle(req('/y'))).text()).toBe('mapped');
  });
});

const again = (ctx: RequestContext) => ctx.body();

describe('body, config, logger', () => {
  test('body is parsed only with a schema; ctx.body() shares one parse; bodyLimit gives 413', async () => {
    const app = await Suku.create({
      bodyLimit: 32,
      routes: [
        route.post('/typed', { body: z.object({ a: z.number() }), handle: ({ body }) => body }),
        route.post('/manual', {
          handle: async ({ body, ctx }) => ({
            none: body === undefined,
            same: (await ctx.body()) === (await again(ctx)),
          }),
        }),
        route.post('/form', { handle: ({ ctx }) => ctx.body() }),
      ],
    });
    expect(await (await app.handle(json('/typed', { a: 1 }))).json()).toEqual({ a: 1 });
    expect(await (await app.handle(json('/manual', { a: 1 }))).json()).toEqual({
      none: true,
      same: true,
    });
    const form = await app.handle(
      req('/form', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'a=1&b=x&b=y',
      }),
    );
    expect(await form.json()).toEqual({ a: '1', b: ['x', 'y'] });
    expect((await app.handle(json('/typed', { a: 1, pad: 'x'.repeat(64) }))).status).toBe(413);
  });

  test('defineConfig loads as a feature, injects typed, and fails fast', async () => {
    const Env = defineConfig(
      'env',
      z.object({ PORT: z.coerce.number().default(3000), NAME: z.string().min(1) }),
    );
    @Routes('/c')
    class C {
      constructor(@Inject(Env) private readonly env: Infer<typeof Env.schema>) {}
      get = route.get('/', { handle: () => this.env });
    }
    const app = await Suku.create({
      features: [Env.load({ NAME: 'suku', PORT: '8080' })],
      routes: [C],
    });
    expect(await (await app.handle(req('/c'))).json()).toEqual({ PORT: 8080, NAME: 'suku' });
    const failing = Suku.create({ features: [Env.load({ PORT: 'abc' })], routes: [C] });
    await expect(failing).rejects.toBeInstanceOf(ConfigError);
    await expect(failing).rejects.toThrow(/Invalid configuration "env":\n {2}- PORT: /);
  });

  test('Logger default and replacement; configureServices can swap services; listen needs an adapter', async () => {
    const app = await Suku.create();
    expect(app.get(Logger)).toBeInstanceOf(ConsoleLogger);
    const quiet = await Suku.create({
      configureServices: (s) => s.replace(singleton(Logger, SilentLogger)),
    });
    expect(quiet.get(Logger)).toBeInstanceOf(SilentLogger);
    await expect(app.listen(0)).rejects.toThrow(/adapter/);
    await app.close();
  });
});

describe('errors from inner middlewares and the client address', () => {
  test('an inner middleware that throws still passes back through outer ones as a Response', async () => {
    const seen: number[] = [];
    const app = await Suku.create({
      routes: [
        route.get('/private', {
          middlewares: [
            () => {
              throw new UnauthorizedException();
            },
          ],
          handle: () => 'secret',
        }),
      ],
      middlewares: [
        async (_ctx, next) => {
          const res = await next();
          seen.push(res.status);
          res.headers.set('access-control-allow-origin', '*');
          return res;
        },
      ],
    });
    const res = await app.handle(req('/private'));
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(seen).toEqual([401]);
  });

  test('ctx.remoteAddress comes from the adapter and is undefined in process', async () => {
    const app = await Suku.create({
      routes: [route.get('/ip', { handle: ({ ctx }) => ({ ip: ctx.remoteAddress ?? null }) })],
    });
    expect(await (await app.handle(req('/ip'))).json()).toEqual({ ip: null });
    expect(await (await app.handle(req('/ip'), { remoteAddress: '203.0.113.9' })).json()).toEqual({
      ip: '203.0.113.9',
    });
  });
});
