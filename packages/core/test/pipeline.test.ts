import { describe, expect, test } from 'bun:test';
import { Injectable } from '@suku/di';
import {
  type ArgumentMetadata,
  BadRequestException,
  Catch,
  Controller,
  DefaultValuePipe,
  defineModule,
  type ExceptionFilter,
  Get,
  type Guard,
  type Interceptor,
  type Middleware,
  type Next,
  Param,
  ParseBoolPipe,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  type Pipe,
  Post,
  Query,
  RequestContext,
  SetMetadata,
  Suku,
  scoped,
  UseFilters,
  UseGuards,
  UseInterceptors,
  UseMiddleware,
  UsePipes,
} from '../src/index.js';

const req = (path: string, init?: RequestInit) => new Request(`http://t.local${path}`, init);
const log: string[] = [];
const tag = (name: string): Middleware => ({
  async use(_ctx, next) {
    log.push(`${name}:in`);
    const res = await next();
    log.push(`${name}:out`);
    return res;
  },
});

describe('execution order', () => {
  @Injectable()
  class ClassGuard implements Guard {
    canActivate() {
      log.push('guard:class');
      return true;
    }
  }
  const methodGuard = () => {
    log.push('guard:method');
    return true;
  };
  const interceptor = (name: string): Interceptor => ({
    async intercept(_ctx, next) {
      log.push(`icept:${name}:before`);
      const r = await next();
      log.push(`icept:${name}:after`);
      return r;
    },
  });
  const pipe = (name: string): Pipe => ({
    transform(v) {
      log.push(`pipe:${name}`);
      return v;
    },
  });

  @Controller('o')
  @UseMiddleware(tag('class'))
  @UseGuards(ClassGuard)
  @UseInterceptors(interceptor('class'))
  @UsePipes(pipe('class'))
  class OrderController {
    @Get(':id')
    @UseMiddleware(tag('method'))
    @UseGuards(methodGuard)
    @UseInterceptors(interceptor('method'))
    @UsePipes(pipe('method'))
    get(@Param('id', pipe('param')) id: string) {
      log.push('handler');
      return { id };
    }
  }

  test('global -> module -> class -> method, interceptors nest, pipes end with the param pipe', async () => {
    const app = await Suku.create({
      imports: [defineModule({ controllers: [OrderController], middleware: [tag('module')] })],
      middleware: [tag('global')],
      guards: [
        () => {
          log.push('guard:global');
          return true;
        },
      ],
      interceptors: [interceptor('global')],
      pipes: [pipe('global')],
    });
    log.length = 0;
    expect(await (await app.handle(req('/o/1'))).json()).toEqual({ id: '1' });
    expect(log).toEqual([
      'global:in',
      'module:in',
      'class:in',
      'method:in',
      'guard:global',
      'guard:class',
      'guard:method',
      'icept:global:before',
      'icept:class:before',
      'icept:method:before',
      'pipe:global',
      'pipe:class',
      'pipe:method',
      'pipe:param',
      'handler',
      'icept:method:after',
      'icept:class:after',
      'icept:global:after',
      'method:out',
      'class:out',
      'module:out',
      'global:out',
    ]);
  });
});

describe('middleware', () => {
  @Controller('m')
  class C {
    @Get()
    get() {
      return 'ok';
    }
  }

  test('runs for unmatched routes and can short-circuit', async () => {
    const seen: string[] = [];
    const app = await Suku.create({
      controllers: [C],
      middleware: [
        async (ctx, next) => {
          seen.push(`${ctx.method} ${ctx.url.pathname} route=${ctx.route?.path}`);
          if (ctx.url.pathname === '/blocked') return new Response('nope', { status: 418 });
          const res = await next();
          res.headers.set('x-mw', '1');
          return res;
        },
      ],
    });
    expect((await app.handle(req('/m'))).headers.get('x-mw')).toBe('1');
    const nf = await app.handle(req('/missing'));
    expect(nf.status).toBe(404);
    expect(nf.headers.get('x-mw')).toBe('1');
    expect((await app.handle(req('/blocked'))).status).toBe(418);
    expect(seen).toEqual([
      'GET /m route=/m',
      'GET /missing route=undefined',
      'GET /blocked route=undefined',
    ]);
  });

  test('app.use() after create; calling next twice is an error', async () => {
    const app = await Suku.create({ controllers: [C], onError: () => {} });
    app.use(async (_ctx, next) => {
      await next();
      return next();
    });
    expect((await app.handle(req('/m'))).status).toBe(500);
  });
});

describe('guards', () => {
  const Roles = (...roles: string[]) => SetMetadata('roles', roles);

  @Injectable({ lifetime: 'scoped' })
  class RolesGuard implements Guard {
    constructor(private readonly ctx: RequestContext) {}
    canActivate() {
      const required = this.ctx.getMetadata<string[]>('roles') ?? [];
      const have = this.ctx.headers.get('x-role');
      return required.length === 0 || (have !== null && required.includes(have));
    }
  }

  @Controller('g')
  @UseGuards(RolesGuard)
  @Roles('user')
  class G {
    @Get('open')
    open() {
      return 'open';
    }
    @Get('admin')
    @Roles('admin')
    admin() {
      return 'admin';
    }
  }

  test('DI-resolved scoped guard reads @SetMetadata with method overriding class', async () => {
    const app = await Suku.create({ controllers: [G] });
    expect((await app.handle(req('/g/open'))).status).toBe(403);
    expect(await (await app.handle(req('/g/open', { headers: { 'x-role': 'user' } }))).text()).toBe(
      'open',
    );
    expect((await app.handle(req('/g/admin', { headers: { 'x-role': 'user' } }))).status).toBe(403);
    expect(
      await (await app.handle(req('/g/admin', { headers: { 'x-role': 'admin' } }))).text(),
    ).toBe('admin');
    const body = await (await app.handle(req('/g/open'))).json();
    expect(body).toEqual({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' });
  });

  test('global guards via options and useGlobalGuards; unregistered class is rejected clearly', async () => {
    const app = await Suku.create({
      controllers: [G],
      guards: [(ctx) => ctx.headers.has('x-key')],
    });
    expect((await app.handle(req('/g/open', { headers: { 'x-role': 'user' } }))).status).toBe(403);
    expect(
      (await app.handle(req('/g/open', { headers: { 'x-role': 'user', 'x-key': '1' } }))).status,
    ).toBe(200);
    class Unregistered implements Guard {
      canActivate() {
        return true;
      }
    }
    expect(() => app.useGlobalGuards(Unregistered)).toThrow(/not registered/);
    app.useGlobalGuards(new Unregistered(), RolesGuard); // instance ok; RolesGuard already registered via decorator
  });
});

describe('interceptors', () => {
  @Controller('i')
  class I {
    @Get()
    get() {
      return { n: 1 };
    }
    @Get('boom')
    boom() {
      throw new Error('boom');
    }
  }

  test('transform results, see thrown errors, and may return a Response', async () => {
    const app = await Suku.create({
      controllers: [I],
      interceptors: [
        async (ctx, next) => {
          try {
            const r = await next();
            return ctx.url.searchParams.has('raw') ? new Response('raw') : { data: r, ms: 0 };
          } catch (e) {
            return { recovered: (e as Error).message };
          }
        },
      ],
    });
    expect(await (await app.handle(req('/i'))).json()).toEqual({ data: { n: 1 }, ms: 0 });
    expect(await (await app.handle(req('/i?raw'))).text()).toBe('raw');
    expect(await (await app.handle(req('/i/boom'))).json()).toEqual({ recovered: 'boom' });
  });
});

describe('pipes', () => {
  @Controller('p')
  class P {
    @Get('int/:id')
    int(@Param('id', ParseIntPipe) id: number) {
      return { id, type: typeof id };
    }
    @Get('q')
    q(
      @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
      @Query('on', new DefaultValuePipe('false'), ParseBoolPipe) on: boolean,
      @Query('sort', new DefaultValuePipe('asc'), new ParseEnumPipe(['asc', 'desc'])) sort: string,
    ) {
      return { page, on, sort };
    }
    @Get('uuid/:id')
    uuid(@Param('id', ParseUUIDPipe) id: string) {
      return id;
    }
    @Get('meta/:id')
    meta(
      @Param('id', (v, m: ArgumentMetadata) => `${m.kind}:${m.data}:${m.type?.name}:${v}`)
      id: string,
    ) {
      return id;
    }
    @Post('pipe-only')
    pipeOnly(@Query(ParseIntPipe) all: unknown) {
      return { all };
    }
  }

  test('built-in pipes convert and reject with 400', async () => {
    const app = await Suku.create({ controllers: [P] });
    expect(await (await app.handle(req('/p/int/42'))).json()).toEqual({ id: 42, type: 'number' });
    const bad = await app.handle(req('/p/int/abc'));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({
      statusCode: 400,
      message: 'Validation failed for param "id": an integer is expected',
      error: 'Bad Request',
    });
    expect(await (await app.handle(req('/p/q'))).json()).toEqual({
      page: 1,
      on: false,
      sort: 'asc',
    });
    expect(await (await app.handle(req('/p/q?page=3&on=true&sort=desc'))).json()).toEqual({
      page: 3,
      on: true,
      sort: 'desc',
    });
    expect((await app.handle(req('/p/q?sort=sideways'))).status).toBe(400);
    expect((await app.handle(req('/p/uuid/not-a-uuid'))).status).toBe(400);
    expect((await app.handle(req('/p/uuid/123e4567-e89b-42d3-a456-426614174000'))).status).toBe(
      200,
    );
  });

  test('ArgumentMetadata carries kind, data and the TypeScript type; pipe may replace data', async () => {
    const app = await Suku.create({ controllers: [P] });
    expect(await (await app.handle(req('/p/meta/7'))).text()).toBe('Param:id:String:7');
    // @Query(ParseIntPipe): the pipe stands in for the data argument.
    expect((await app.handle(req('/p/pipe-only?x=1', { method: 'POST' }))).status).toBe(400);
  });

  test('global pipe via options applies to every parameter', async () => {
    const app = await Suku.create({
      controllers: [P],
      pipes: [(v) => (typeof v === 'string' ? v.trim() : v)],
    });
    expect(await (await app.handle(req('/p/int/%2042%20'))).json()).toEqual({
      id: 42,
      type: 'number',
    });
  });
});

describe('exception filters', () => {
  class DomainError extends Error {}
  class OtherError extends Error {}

  @Catch(DomainError)
  class DomainFilter implements ExceptionFilter {
    catch(error: unknown) {
      return Response.json({ domain: (error as Error).message }, { status: 422 });
    }
  }

  @Controller('f')
  @UseFilters(DomainFilter)
  class F {
    @Get('domain')
    domain() {
      throw new DomainError('invalid state');
    }
    @Get('other')
    other() {
      throw new OtherError('other');
    }
    @Get('method')
    @UseFilters((e: unknown) =>
      e instanceof OtherError ? new Response('method filter', { status: 409 }) : undefined,
    )
    method() {
      throw new OtherError('x');
    }
    @Get('http')
    http() {
      throw new BadRequestException('bad');
    }
  }

  test('@Catch restricts; method filters run before class filters; undefined falls through', async () => {
    const errors: unknown[] = [];
    const app = await Suku.create({ controllers: [F], onError: (e) => errors.push(e) });
    const d = await app.handle(req('/f/domain'));
    expect(d.status).toBe(422);
    expect(await d.json()).toEqual({ domain: 'invalid state' });
    expect((await app.handle(req('/f/other'))).status).toBe(500); // DomainFilter does not apply
    expect(errors).toHaveLength(1);
    expect((await app.handle(req('/f/method'))).status).toBe(409);
    expect((await app.handle(req('/f/http'))).status).toBe(400);
  });

  test('global filters see 404s and middleware errors; a throwing filter yields 500', async () => {
    const errors: string[] = [];
    const app = await Suku.create({
      controllers: [F],
      onError: (e) => errors.push((e as Error).message),
      middleware: [
        async (ctx, next) => {
          if (ctx.url.pathname === '/mw-throws') throw new DomainError('from middleware');
          return next();
        },
      ],
      filters: [
        (e, ctx) =>
          ctx.route === undefined && !(e instanceof DomainError)
            ? Response.json({ missing: ctx.url.pathname }, { status: 404 })
            : undefined,
        DomainFilter,
      ],
    });
    expect(await (await app.handle(req('/nope'))).json()).toEqual({ missing: '/nope' });
    expect((await app.handle(req('/mw-throws'))).status).toBe(422);
    app.useGlobalFilters(() => {
      throw new Error('filter broke');
    });
    // DomainFilter (class-level) handles /f/domain first; /f/other reaches the throwing global filter.
    expect((await app.handle(req('/f/domain'))).status).toBe(422);
    expect((await app.handle(req('/f/other'))).status).toBe(500);
    expect(errors).toEqual(['filter broke']);
  });

  test('scope is disposed even when a filter produced the response', async () => {
    const disposed: number[] = [];
    let n = 0;
    @Injectable()
    class Unit {
      id = ++n;
      dispose() {
        disposed.push(this.id);
      }
    }
    @Controller('u')
    class U {
      constructor(private readonly unit: Unit) {}
      @Get()
      get() {
        throw new DomainError(String(this.unit.id));
      }
    }
    const app = await Suku.create({
      controllers: [U],
      services: [scoped(Unit), { provide: U, useClass: U, lifetime: 'scoped' }],
      filters: [DomainFilter],
    });
    expect((await app.handle(req('/u'))).status).toBe(422);
    expect(disposed).toEqual([1]);
  });
});
