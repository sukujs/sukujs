# Suku

A lightweight TypeScript backend framework. NestJS-shaped structure (controllers, decorators,
a request pipeline, modules) on a flat .NET-style dependency injection container with
singleton, scoped and transient lifetimes. Zero runtime dependencies. Runs on Node and Bun.

```ts
import { Body, Controller, Get, Param, Post, Suku, defineModule, singleton } from '@suku/core';
import { Injectable } from '@suku/di';
import { nodeAdapter } from '@suku/platform-node';
import { z } from 'zod';

const CreateUser = z.object({ name: z.string().min(2) });

@Injectable()
class UsersService {
  find(id: string) {
    return { id, name: 'Ada' };
  }
}

@Controller('users')
class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.find(id);
  }

  @Post()
  create(@Body(CreateUser) dto: z.infer<typeof CreateUser>) {
    return dto;
  }
}

const UsersModule = defineModule({
  controllers: [UsersController],
  services: [singleton(UsersService)],
});

const app = await Suku.create({ imports: [UsersModule], adapter: nodeAdapter() });
await app.listen(3000);
```

## Packages

| Package               | What it is                                                                                                            | Size (min) |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------- |
| `@suku/di`            | Container: `ServiceCollection`, lifetimes, scopes, keyed services, disposal, build-time validation                    | 13 KB      |
| `@suku/core`          | Modules, controllers, router, pipeline (middleware, guards, interceptors, pipes, filters), validation, config, logger | 24 KB      |
| `@suku/platform-node` | `node:http` adapter                                                                                                   | 2 KB       |
| `@suku/platform-bun`  | `Bun.serve` adapter                                                                                                   | 1 KB       |

## Why not just NestJS?

- **DI like .NET**: one flat service collection, explicit lifetimes, a scope per request,
  captive-dependency and cycle detection at startup, disposal in reverse order.
- **Modules are typed objects**, not decorated empty classes. `singleton(Logger, ConsoleLogger)`
  is type-checked; `ConfigModule(opts)` is a function, not `forRoot`.
- **Web-standard core**: the kernel speaks Fetch `Request`/`Response`, so adapters are tiny and
  Bun runs at parity with raw `Bun.serve`.
- **Validation via Standard Schema**: Zod, Valibot or ArkType plug in with no adapter.
- **No RxJS, no reflect-metadata, no Express**: zero runtime dependencies.

## Development

```bash
bun install
bun run check        # lint, typecheck, tests (Bun + Node), build, size budgets
bun run --cwd examples/hello dev
```

Compile with `experimentalDecorators` and `emitDecoratorMetadata`. See [PLAN.md](PLAN.md) for
the design decisions and roadmap, and each package's README for its API.

## License

MIT
