# @suku/core

NestJS-shaped structure on a flat .NET-style container.

```ts
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Suku,
  defineModule,
  singleton,
} from '@suku/core';
import { Injectable } from '@suku/di';
import { nodeAdapter } from '@suku/platform-node';

@Injectable()
class UsersService {
  find(id: string) {
    /* ... */
  }
}

@Controller('users')
class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return (
      this.users.find(id) ??
      (() => {
        throw new NotFoundException();
      })()
    );
  }

  @Post()
  create(@Body('name') name: string) {
    return { name }; // objects become JSON; POST defaults to 201
  }
}

const UsersModule = defineModule({
  name: 'users',
  controllers: [UsersController],
  services: [singleton(UsersService)],
});

const app = await Suku.create({ imports: [UsersModule], adapter: nodeAdapter() });
await app.listen(3000);
```

- **Modules are plain objects** from `defineModule()`, so a parameterised module is a function
  (`ConfigModule(schema)`) and the root can be inline in `Suku.create`. `@Module` on a class
  still works as a NestJS-style alias. Imports are walked once; every service lands in one
  flat `ServiceCollection`, so `exports` is recorded but not enforced in v1.
- **Typed registration**: `singleton(Logger, ConsoleLogger)`, `scoped(UnitOfWork)`,
  `value(CONFIG, cfg)`, `factory(Mailer, (sp) => ...)`, `alias(Cache, RedisCache)`. The
  implementation is checked against the token at compile time.
- **Controllers** are singletons by default. `@Controller({ lifetime: 'scoped' })` gives a
  fresh instance per request. `RequestContext` is injectable into scoped and transient services.
- **A DI scope is created per request** and disposed after the response.
- **Return values**: `Response` passes through, `undefined` is 204, strings are text,
  `Uint8Array` is octet-stream, everything else is JSON. `@HttpCode`, `@Header`, `@Redirect`
  adjust the result.
- **Errors**: throw an `HttpException` subclass for a `{ statusCode, message, error }` body;
  anything else is a 500 and goes to `onError`.
- **Pipeline**: middleware → guards → interceptors → pipes → handler → interceptors → filters.
  Each piece is a class (resolved from the request scope, so it can inject `RequestContext`),
  an instance, or a plain function. Attach with `@UseMiddleware`, `@UseGuards`,
  `@UseInterceptors`, `@UsePipes`, `@UseFilters` on a class or method, with
  `middleware: [...]` on a module, or globally through `Suku.create` options or
  `app.use()` / `app.useGlobal*()`. Order is global → module → class → method; filters run
  most-specific first and `@Catch(ErrorType)` restricts one.
- **Pipes on parameters**: `@Param('id', ParseIntPipe)`, `@Query('page', new DefaultValuePipe(1), ParseIntPipe)`.
  Built-ins: `ParseIntPipe`, `ParseFloatPipe`, `ParseBoolPipe`, `ParseUUIDPipe`, `ParseEnumPipe`, `DefaultValuePipe`.
- **Validation through Standard Schema**: pass a Zod, Valibot or ArkType schema where a pipe
  goes: `@Body(CreateUser)`, `@Query(ListQuery)`, `@Param('id', Id)`. Failures are a 400 with
  `issues: [{ path, message }]`. Type the parameter with `Infer<typeof CreateUser>`. Suku has
  no dependency on any schema library.
- **Configuration**: `const Env = defineConfig('env', schema)`; import `Env.load()` (validates
  `process.env` at startup, fails fast with every issue listed) and inject with `@Inject(Env)`.
- **Body**: `ctx.body()` parses JSON, forms, multipart, text or bytes once per request;
  `@Body()` uses it. `Suku.create({ bodyLimit })` caps the size (default 1 MiB, 413 beyond).
- **Logger**: an abstract `Logger` with a `ConsoleLogger` default; replace with
  `singleton(Logger, MyLogger)`. Unhandled errors are reported through it.
- **Metadata for guards**: `@SetMetadata(key, value)` on a class or method, read with
  `ctx.getMetadata(key)`. `const Roles = (...r) => SetMetadata('roles', r)`.
- **Testing**: `app.handle(new Request(...))` runs a request in-process with no sockets.

Compile with `experimentalDecorators` and `emitDecoratorMetadata`. Bun runs the sources
directly; for Node, compile with `tsc` or bundle with `bun build --target node`.

## Linter note

Constructor injection reads the parameter's class at runtime, so the import must be a value
import. Rules that rewrite imports used only in type positions to `import type` (Biome's
`style/useImportType`, ESLint's `consistent-type-imports`) erase the class and the parameter
compiles to `Object`. Disable those rules, or Suku will fail at startup with
`UnresolvableParameterError` naming the parameter.
