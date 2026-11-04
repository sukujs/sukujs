import { describe, expect, test } from 'bun:test';
import { Inject, Injectable } from '@suku/di';
import { z } from 'zod';
import {
  Body,
  ConfigError,
  ConsoleLogger,
  Controller,
  Ctx,
  defineConfig,
  Get,
  type Infer,
  Logger,
  Param,
  Post,
  Query,
  RequestContext,
  SilentLogger,
  type StandardSchema,
  Suku,
  singleton,
  ValidationException,
  ValidationPipe,
  validate,
} from '../src/index.js';

const req = (path: string, init?: RequestInit) => new Request(`http://t.local${path}`, init);
const json = (path: string, body: unknown, method = 'POST') =>
  req(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A hand-rolled Standard Schema, to prove no library is required. */
function positiveInt(): StandardSchema<unknown, number> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value) {
        const n = typeof value === 'string' ? Number(value) : value;
        return typeof n === 'number' && Number.isInteger(n) && n > 0
          ? { value: n }
          : { issues: [{ message: 'must be a positive integer' }] };
      },
    },
  };
}

const CreateUser = z.object({
  name: z.string().min(2),
  email: z.email(),
  address: z.object({ street: z.string(), zip: z.string().length(5) }).optional(),
});
const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().optional(),
});

@Controller('v')
class V {
  @Post()
  create(@Body(CreateUser) dto: Infer<typeof CreateUser>) {
    return { ok: true, name: dto.name, hasAddress: dto.address !== undefined };
  }

  @Get()
  list(@Query(ListQuery) query: Infer<typeof ListQuery>) {
    return query;
  }

  @Get(':id')
  get(@Param('id', positiveInt()) id: number) {
    return { id, type: typeof id };
  }

  @Post('explicit')
  explicit(@Body('name', new ValidationPipe(z.string().min(2))) name: string) {
    return { name };
  }
}

describe('Standard Schema validation', () => {
  test('@Body(schema) parses and returns typed output', async () => {
    const app = await Suku.create({ controllers: [V] });
    const res = await app.handle(json('/v', { name: 'Ada', email: 'ada@example.com' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, name: 'Ada', hasAddress: false });
  });

  test('invalid body -> 400 with dotted issue paths', async () => {
    const app = await Suku.create({ controllers: [V] });
    const res = await app.handle(
      json('/v', { name: 'A', email: 'nope', address: { street: 'x', zip: '1' } }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      message: string;
      issues: { path: string; message: string }[];
    };
    expect(body.message).toBe('Validation failed for body');
    expect(body.issues.map((i) => i.path).sort()).toEqual(['address.zip', 'email', 'name']);
  });

  test('@Query(schema) coerces and applies defaults', async () => {
    const app = await Suku.create({ controllers: [V] });
    expect(await (await app.handle(req('/v'))).json()).toEqual({ page: 1 });
    expect(await (await app.handle(req('/v?page=3&q=x'))).json()).toEqual({ page: 3, q: 'x' });
    expect((await app.handle(req('/v?page=0'))).status).toBe(400);
  });

  test('hand-rolled schema on a param; explicit ValidationPipe on a body field', async () => {
    const app = await Suku.create({ controllers: [V] });
    expect(await (await app.handle(req('/v/7'))).json()).toEqual({ id: 7, type: 'number' });
    const bad = (await (await app.handle(req('/v/-1'))).json()) as { message: string };
    expect(bad.message).toBe('Validation failed for param "id"');
    expect((await app.handle(json('/v/explicit', { name: 'ok' }))).status).toBe(201);
    expect((await app.handle(json('/v/explicit', { name: 'x' }))).status).toBe(400);
  });

  test('validate() helper and ValidationException outside the pipeline', async () => {
    expect(await validate(ListQuery, { page: '2' })).toEqual({ page: 2 });
    await expect(validate(CreateUser, {})).rejects.toBeInstanceOf(ValidationException);
    try {
      await validate(CreateUser, {}, 'input');
    } catch (e) {
      expect((e as ValidationException).status).toBe(400);
      expect((e as ValidationException).issues.length).toBeGreaterThan(0);
      expect((e as ValidationException).getBody().message).toBe('Validation failed for input');
    }
  });
});

describe('body parsing and limits', () => {
  @Controller('b')
  class B {
    @Post('echo')
    echo(@Body() body: unknown, @Ctx() ctx: RequestContext) {
      return { body, same: undefined as unknown };
    }
    @Post('shared')
    async shared(@Body() body: unknown, @Ctx() ctx: RequestContext) {
      return { body, same: body === (await ctx.body()) };
    }
    @Post('form')
    form(@Body() body: unknown) {
      return body;
    }
    @Post('multipart')
    async multipart(@Body() body: FormData) {
      return { name: body.get('name'), file: await (body.get('file') as File).text() };
    }
  }

  test('json, text, urlencoded, multipart, binary, and the shared parse', async () => {
    const app = await Suku.create({ controllers: [B] });
    expect(await (await app.handle(json('/b/echo', { a: 1 }))).json()).toEqual({ body: { a: 1 } });
    expect(await (await app.handle(req('/b/echo', { method: 'POST', body: 'hi' }))).json()).toEqual(
      { body: 'hi' },
    );
    const form = await app.handle(
      req('/b/form', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'a=1&b=x&b=y',
      }),
    );
    expect(await form.json()).toEqual({ a: '1', b: ['x', 'y'] });
    const fd = new FormData();
    fd.set('name', 'n');
    fd.set('file', new File(['content'], 'f.txt'));
    expect(
      await (await app.handle(req('/b/multipart', { method: 'POST', body: fd }))).json(),
    ).toEqual({
      name: 'n',
      file: 'content',
    });
    const bin = await app.handle(
      req('/b/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array([1, 2]),
      }),
    );
    expect(await bin.json()).toEqual({ body: { '0': 1, '1': 2 } });
    const shared = (await (await app.handle(json('/b/shared', { x: 1 }))).json()) as {
      same: boolean;
    };
    expect(shared.same).toBe(true);
  });

  test('bodyLimit -> 413 via content-length and via streaming', async () => {
    const app = await Suku.create({ controllers: [B], bodyLimit: 16 });
    const big = await app.handle(json('/b/echo', { text: 'x'.repeat(100) }));
    expect(big.status).toBe(413);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('"'));
        c.enqueue(new TextEncoder().encode('y'.repeat(50)));
        c.enqueue(new TextEncoder().encode('"'));
        c.close();
      },
    });
    const chunked = await app.handle(
      new Request('http://t.local/b/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: stream,
        duplex: 'half',
      }),
    );
    expect(chunked.status).toBe(413);
    expect((await app.handle(json('/b/echo', { a: 1 }))).status).toBe(201);
  });
});

describe('defineConfig', () => {
  const Env = defineConfig(
    'env',
    z.object({ PORT: z.coerce.number().int().default(3000), NAME: z.string().min(1) }),
  );

  @Controller('c')
  class C {
    constructor(@Inject(Env) private readonly env: Infer<typeof Env.schema>) {}
    @Get()
    get() {
      return this.env;
    }
  }

  test('load() validates a source and provides the typed value', async () => {
    const app = await Suku.create({
      imports: [Env.load({ NAME: 'suku', PORT: '8080' })],
      controllers: [C],
    });
    expect(await (await app.handle(req('/c'))).json()).toEqual({ PORT: 8080, NAME: 'suku' });
    expect(app.get(Env).PORT).toBe(8080);
  });

  test('invalid configuration fails at startup with a readable ConfigError', async () => {
    const creating = Suku.create({ imports: [Env.load({ PORT: 'abc' })], controllers: [C] });
    await expect(creating).rejects.toBeInstanceOf(ConfigError);
    await expect(creating).rejects.toThrow(
      /Invalid configuration "env":\n {2}- PORT: .*\n {2}- NAME: /,
    );
  });

  test('defaults to process.env', async () => {
    process.env.NAME = 'from-env';
    try {
      expect((await Env.parse()).NAME).toBe('from-env');
    } finally {
      delete process.env.NAME;
    }
  });
});

describe('Logger', () => {
  @Injectable()
  class Uses {
    constructor(readonly log: Logger) {}
  }
  @Controller('l')
  class L {
    @Get('boom')
    boom() {
      throw new Error('kaboom');
    }
  }

  test('ConsoleLogger is registered by default and can be replaced', async () => {
    const app = await Suku.create({ services: [singleton(Uses)] });
    expect(app.get(Uses).log).toBeInstanceOf(ConsoleLogger);
    const app2 = await Suku.create({
      services: [singleton(Uses), singleton(Logger, SilentLogger)],
    });
    expect(app2.get(Uses).log).toBeInstanceOf(SilentLogger);
  });

  test('unhandled errors are reported through the Logger by default', async () => {
    const entries: unknown[] = [];
    class Capture extends Logger {
      log(level: string, message: string, meta?: Record<string, unknown>) {
        entries.push({ level, message, path: meta?.path });
      }
    }
    const app = await Suku.create({ controllers: [L], services: [singleton(Logger, Capture)] });
    expect((await app.handle(req('/l/boom'))).status).toBe(500);
    expect(entries).toEqual([{ level: 'error', message: 'kaboom', path: '/l/boom' }]);
  });
});
