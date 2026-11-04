import { describe, expect, test } from 'bun:test';
import { Inject, Injectable, InjectionToken } from '@suku/di';
import {
  Controller,
  defineModule,
  factory,
  Get,
  Module,
  ModuleError,
  RequestContext,
  Suku,
  scoped,
  singleton,
  value,
} from '../src/index.js';

const req = (path: string) => new Request(`http://t.local${path}`);

abstract class Logger {
  abstract tag: string;
}
@Injectable()
class ConsoleLogger extends Logger {
  tag = 'console';
}
const CONFIG = new InjectionToken<{ name: string }>('CONFIG');

@Injectable()
class UsersService {
  constructor(readonly log: Logger) {}
}

@Controller('users')
class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get()
  list() {
    return { log: this.users.log.tag };
  }
}

const UsersModule = defineModule({
  name: 'users',
  controllers: [UsersController],
  services: [singleton(UsersService)],
});

/** Parameterised module as a plain function; no forRoot ceremony. */
const ConfigModule = (cfg: { name: string }) =>
  defineModule({ name: 'config', services: [value(CONFIG, cfg)] });

@Controller()
class RootController {
  constructor(@Inject(CONFIG) private readonly cfg: { name: string }) {}
  @Get()
  root() {
    return this.cfg;
  }
}

describe('defineModule', () => {
  test('object modules, typed helpers, function modules', async () => {
    const App = defineModule({
      name: 'app',
      imports: [UsersModule, ConfigModule({ name: 'suku' })],
      controllers: [RootController],
      services: [singleton(Logger, ConsoleLogger)],
    });
    const app = await Suku.create(App);
    expect(await (await app.handle(req('/users'))).json()).toEqual({ log: 'console' });
    expect(await (await app.handle(req('/'))).json()).toEqual({ name: 'suku' });
    expect(app.get(Logger)).toBeInstanceOf(ConsoleLogger);
  });

  test('inline root: module options and app options in one object', async () => {
    const errors: unknown[] = [];
    const app = await Suku.create({
      imports: [UsersModule, ConfigModule({ name: 'inline' })],
      controllers: [RootController],
      services: [singleton(Logger, ConsoleLogger)],
      globalPrefix: '/api',
      onError: (e) => errors.push(e),
    });
    expect(await (await app.handle(req('/api'))).json()).toEqual({ name: 'inline' });
    expect((await app.handle(req('/'))).status).toBe(404);
    expect(app.routes.map((r) => r.path)).toEqual(['/api/users', '/api']);
  });

  test('scoped helper and factory with the request scope', async () => {
    let n = 0;
    @Injectable()
    class Rid {
      id = ++n;
    }
    // The controller itself must be scoped to see per-request instances.
    @Controller({ path: 'r', lifetime: 'scoped' })
    class C {
      constructor(
        private readonly rid: Rid,
        @Inject('path') private readonly path: string,
      ) {}
      @Get()
      get() {
        return { id: this.rid.id, path: this.path };
      }
    }
    const app = await Suku.create({
      controllers: [C],
      services: [
        scoped(Rid),
        factory('path', (sp) => sp.get(RequestContext).url.pathname, 'scoped'),
      ],
    });
    expect(await (await app.handle(req('/r'))).json()).toEqual({ id: 1, path: '/r' });
    expect(await (await app.handle(req('/r'))).json()).toEqual({ id: 2, path: '/r' });
  });

  test('definitions are deduplicated by identity; @Module classes mix with definitions', async () => {
    let built = 0;
    @Injectable()
    class Shared {
      constructor() {
        built++;
      }
    }
    const SharedModule = defineModule({ name: 'shared', services: [singleton(Shared)] });
    @Module({ imports: [SharedModule] })
    class LegacyA {}
    const B = defineModule({ imports: [SharedModule, LegacyA] });
    const app = await Suku.create(defineModule({ imports: [B, LegacyA, SharedModule] }));
    app.get(Shared);
    expect(built).toBe(1);
  });

  test('errors name the module and the import chain', async () => {
    const Bad = defineModule({ name: 'bad', imports: [class NotAModule {}] });
    const Root = defineModule({ name: 'root', imports: [Bad] });
    await expect(Suku.create(Root)).rejects.toThrow(ModuleError);
    await expect(Suku.create(Root)).rejects.toThrow(
      /NotAModule is not a module \(imported via root -> bad\)/,
    );
  });

  test('circular imports between definitions are reported', async () => {
    const A: { imports: unknown[] } = { imports: [] };
    const DefA = defineModule(A as never);
    const DefB = defineModule({ name: 'b', imports: [DefA] });
    (DefA.imports as unknown[]).push(DefB);
    await expect(Suku.create(DefA)).rejects.toThrow(/Circular module import/);
  });

  test('type-level: services entries are checked', () => {
    @Injectable()
    class Unrelated {}
    defineModule({
      services: [
        // @ts-expect-error Unrelated is not a Logger
        singleton(Logger, Unrelated),
        // @ts-expect-error wrong value shape
        value(CONFIG, { name: 1 }),
      ],
    });
    expect(true).toBe(true);
  });
});
