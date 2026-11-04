import { describe, expect, test } from 'bun:test';
import { Inject, Injectable, InjectionToken } from '@suku/di';
import {
  Body,
  Controller,
  Ctx,
  createParamDecorator,
  Delete,
  type DynamicModule,
  Get,
  Header,
  Headers,
  HttpCode,
  Module,
  ModuleError,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Redirect,
  Req,
  RequestContext,
  RouteConflictError,
  Suku,
} from '../src/index.js';

interface User {
  id: string;
  name: string;
}

@Injectable()
class UsersService {
  private readonly users = new Map<string, User>([['1', { id: '1', name: 'Ada' }]]);
  find(id: string) {
    return this.users.get(id);
  }
  list() {
    return [...this.users.values()];
  }
  create(name: string): User {
    const u = { id: String(this.users.size + 1), name };
    this.users.set(u.id, u);
    return u;
  }
}

const CurrentHost = createParamDecorator('CurrentHost', (_d, ctx) => ctx.url.host);

@Controller('users')
class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query('page') page?: string, @Query() all?: Record<string, unknown>) {
    return { page, all, users: this.users.list() };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const user = this.users.find(id);
    if (!user) throw new NotFoundException(`No user ${id}`);
    return user;
  }

  @Post()
  create(@Body('name') name: string, @Body() body: unknown) {
    return { ...this.users.create(name), echo: body };
  }

  @Put(':id')
  @HttpCode(200)
  replace(@Param() params: Record<string, string>, @Body() body: { name: string }) {
    return { id: params.id, name: body.name };
  }

  @Delete(':id')
  remove() {
    return undefined;
  }

  @Get(':id/raw')
  @Header('x-powered-by', 'suku')
  raw(
    @Req() req: Request,
    @Ctx() ctx: RequestContext,
    @Headers('x-a') a: string,
    @CurrentHost() host: string,
  ) {
    return `${req.method} ${ctx.route?.path} ${a} ${host} ${ctx.params.id}`;
  }

  @Get('go')
  @Redirect('/users', 301)
  go(@Query('to') to?: string) {
    return to ? { url: to, status: 302 } : undefined;
  }

  @Get('custom')
  custom() {
    return new Response('custom', { status: 202, headers: { 'x-c': '1' } });
  }

  @Get('bytes')
  bytes() {
    return new Uint8Array([1, 2]);
  }

  @Get('boom')
  boom() {
    throw new Error('boom');
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
class UsersModule {}

@Module({ imports: [UsersModule] })
class AppModule {}

const req = (path: string, init?: RequestInit) => new Request(`http://test.local${path}`, init);
const json = (body: unknown, init?: RequestInit) =>
  new Request('http://test.local/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });

describe('Suku application', () => {
  const errors: unknown[] = [];
  const appP = Suku.create(AppModule, { onError: (e) => errors.push(e) });

  test('route table', async () => {
    const app = await appP;
    expect(app.routes.map((r) => `${r.method} ${r.path}`)).toContain('GET /users/:id');
    expect(app.routes.map((r) => `${r.method} ${r.path}`)).toContain('POST /users');
  });

  test('GET list with query', async () => {
    const app = await appP;
    const res = await app.handle(req('/users?page=2&tag=a&tag=b'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      page: '2',
      all: { page: '2', tag: ['a', 'b'] },
      users: [{ id: '1', name: 'Ada' }],
    });
  });

  test('GET by param, 404 via NotFoundException', async () => {
    const app = await appP;
    expect(await (await app.handle(req('/users/1'))).json()).toEqual({ id: '1', name: 'Ada' });
    const res = await app.handle(req('/users/9'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ statusCode: 404, message: 'No user 9', error: 'Not Found' });
  });

  test('POST with JSON body -> 201; body parsed once and shared', async () => {
    const app = await appP;
    const res = await app.handle(json({ name: 'Grace' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: '2', name: 'Grace', echo: { name: 'Grace' } });
  });

  test('malformed JSON -> 400', async () => {
    const app = await appP;
    const res = await app.handle(
      req('/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{nope',
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe('Malformed JSON body');
  });

  test('@HttpCode overrides, @Param() returns all params', async () => {
    const app = await appP;
    const res = await app.handle(
      req('/users/5', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{"name":"X"}',
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: '5', name: 'X' });
  });

  test('undefined -> 204', async () => {
    const app = await appP;
    const res = await app.handle(req('/users/1', { method: 'DELETE' }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  test('string -> text/plain, @Header, @Req, @Ctx, @Headers, custom param decorator', async () => {
    const app = await appP;
    const res = await app.handle(req('/users/7/raw', { headers: { 'x-a': 'hdr' } }));
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('x-powered-by')).toBe('suku');
    expect(await res.text()).toBe('GET /users/:id/raw hdr test.local 7');
  });

  test('@Redirect with and without per-request override', async () => {
    const app = await appP;
    let res = await app.handle(req('/users/go'));
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/users');
    res = await app.handle(req('/users/go?to=/elsewhere'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/elsewhere');
  });

  test('Response passthrough and binary bodies', async () => {
    const app = await appP;
    const res = await app.handle(req('/users/custom'));
    expect(res.status).toBe(202);
    expect(res.headers.get('x-c')).toBe('1');
    const bin = await app.handle(req('/users/bytes'));
    expect(bin.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await bin.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  test('HEAD falls back to GET', async () => {
    const app = await appP;
    const res = await app.handle(req('/users/1', { method: 'HEAD' }));
    expect(res.status).toBe(200);
  });

  test('404 and 405 shapes', async () => {
    const app = await appP;
    const nf = await app.handle(req('/nope'));
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({
      statusCode: 404,
      message: 'Cannot GET /nope',
      error: 'Not Found',
    });
    const mna = await app.handle(req('/users/1', { method: 'PATCH' }));
    expect(mna.status).toBe(405);
    expect(mna.headers.get('allow')).toBe('DELETE, GET, HEAD, PUT');
  });

  test('unknown errors -> 500 and onError hook', async () => {
    const app = await appP;
    const res = await app.handle(req('/users/boom'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      statusCode: 500,
      message: 'Internal Server Error',
      error: 'Internal Server Error',
    });
    expect(errors.map((e) => (e as Error).message)).toEqual(['boom']);
  });

  test('listen() without an adapter is a clear error', async () => {
    const app = await appP;
    await expect(app.listen(0)).rejects.toThrow(/adapter/);
  });
});

describe('scopes and lifetimes', () => {
  let n = 0;
  const disposed: number[] = [];

  @Injectable()
  class RequestId {
    readonly id = ++n;
    constructor(readonly ctx: RequestContext) {}
    dispose() {
      disposed.push(this.id);
    }
  }

  @Controller({ path: 'scoped', lifetime: 'scoped' })
  class ScopedController {
    constructor(private readonly rid: RequestId) {}
    @Get()
    get() {
      return {
        id: this.rid.id,
        path: this.rid.ctx.url.pathname,
        same: this.rid === this.rid.ctx.provider.get(RequestId),
      };
    }
  }

  @Controller('single')
  class SingletonController {
    static instances = 0;
    constructor() {
      SingletonController.instances++;
    }
    @Get()
    get() {
      return { instances: SingletonController.instances };
    }
  }

  @Module({
    controllers: [ScopedController, SingletonController],
    providers: [{ provide: RequestId, useClass: RequestId, lifetime: 'scoped' }],
  })
  class ScopeModule {}

  test('scoped controller and RequestContext injection; scope disposed after response', async () => {
    const app = await Suku.create(ScopeModule);
    const a = await (await app.handle(req('/scoped'))).json();
    const b = (await (await app.handle(req('/scoped'))).json()) as { id: number };
    expect(a).toEqual({ id: 1, path: '/scoped', same: true });
    expect(b.id).toBe(2);
    expect(disposed).toEqual([1, 2]);
  });

  test('singleton controller is constructed once', async () => {
    const app = await Suku.create(ScopeModule);
    await app.handle(req('/single'));
    await app.handle(req('/single'));
    expect(await (await app.handle(req('/single'))).json()).toEqual({ instances: 1 });
    await app.close();
  });
});

describe('modules', () => {
  const CONFIG = new InjectionToken<{ name: string }>('CONFIG');

  @Module({})
  class ConfigModule {
    static forRoot(cfg: { name: string }): DynamicModule {
      return { module: ConfigModule, providers: [{ provide: CONFIG, useValue: cfg }] };
    }
  }

  @Controller()
  class RootController {
    constructor(@Inject(CONFIG) private readonly cfg: { name: string }) {}
    @Get('/')
    root() {
      return this.cfg;
    }
  }

  @Module({ imports: [ConfigModule.forRoot({ name: 'suku' })], controllers: [RootController] })
  class Root {}

  test('dynamic modules and global prefix', async () => {
    const app = await Suku.create(Root, { globalPrefix: '/api/' });
    expect(await (await app.handle(req('/api'))).json()).toEqual({ name: 'suku' });
    expect((await app.handle(req('/'))).status).toBe(404);
    expect(app.get(CONFIG)).toEqual({ name: 'suku' });
  });

  test('configureServices can replace a provider', async () => {
    const app = await Suku.create(Root, {
      configureServices: (s) => s.replace({ provide: CONFIG, useValue: { name: 'replaced' } }),
    });
    expect(await (await app.handle(req('/'))).json()).toEqual({ name: 'replaced' });
  });

  test('undecorated module and controller classes are rejected', async () => {
    class NotAModule {}
    await expect(Suku.create(NotAModule)).rejects.toThrow(ModuleError);
    class NotAController {}
    @Module({ controllers: [NotAController] })
    class Bad {}
    await expect(Suku.create(Bad)).rejects.toThrow(/@Controller/);
  });

  test('duplicate routes across controllers are rejected at startup', async () => {
    @Controller('x')
    class A {
      @Get()
      a() {}
    }
    @Controller('x')
    class B {
      @Get('/')
      b() {}
    }
    @Module({ controllers: [A, B] })
    class Dup {}
    await expect(Suku.create(Dup)).rejects.toThrow(RouteConflictError);
  });

  test('missing provider fails at startup, not at first request', async () => {
    @Injectable()
    class Missing {}
    @Controller('m')
    class NeedsMissing {
      constructor(public m: Missing) {}
      @Get()
      get() {}
    }
    @Module({ controllers: [NeedsMissing] })
    class M {}
    await expect(Suku.create(M)).rejects.toThrow(/No service registered for Missing/);
  });

  test('diamond imports register each module once', async () => {
    @Injectable()
    class Shared {
      static count = 0;
      constructor() {
        Shared.count++;
      }
    }
    @Module({ providers: [Shared] })
    class SharedModule {}
    @Module({ imports: [SharedModule] })
    class A {}
    @Module({ imports: [SharedModule] })
    class B {}
    @Module({ imports: [A, B] })
    class Root2 {}
    const app = await Suku.create(Root2);
    app.get(Shared);
    expect(Shared.count).toBe(1);
  });
});
