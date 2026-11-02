# Suku — a lightweight NestJS-shaped API framework with .NET-style DI

## 1. Goal

A TypeScript backend framework that feels like NestJS to organise (modules, controllers,
providers, decorators, a request pipeline) but whose dependency injection behaves like
`Microsoft.Extensions.DependencyInjection`: a flat service collection, explicit lifetimes
(singleton / scoped / transient), a root provider, per-request scopes, and disposal.

"Extremely lightweight" is a hard constraint, not a slogan:

| Constraint                                 | Target                                                 |
| ------------------------------------------ | ------------------------------------------------------ |
| Runtime dependencies                       | 0 (no `reflect-metadata`, no `rxjs`, no express)       |
| Core bundle (di + core, minified, no gzip) | < 40 KB                                                |
| Request overhead vs raw `node:http`        | < 10% at p50 on a hello-world route                    |
| Cold start to first request                | < 50 ms on Node 22                                     |
| Runtimes                                   | Node 22+, Bun; portable to Deno / Workers via adapters |

## 2. Key design decisions

### 2.1 Decorators and metadata (the hard one)

.NET-style constructor injection needs the _types_ of constructor parameters at runtime.
Only TypeScript's legacy decorators (`experimentalDecorators` + `emitDecoratorMetadata`)
emit that information; TC39 stage-3 decorators cannot see parameter types.

Decision: **legacy decorators + our own ~40-line metadata shim.**

- TypeScript emits `__metadata("design:paramtypes", [...])`, which calls `Reflect.metadata`
  if it exists. We ship a tiny `Reflect.metadata` / `Reflect.getMetadata` polyfill backed
  by a `WeakMap<Function, Map<key, value>>`. No `reflect-metadata` package.
- Bun compiles `emitDecoratorMetadata` natively. Node users compile with `tsc`, `tsx`, or
  `esbuild`; all support it.
- Interfaces are erased at compile time, so .NET's `services.AddSingleton<IFoo, Foo>()`
  becomes either an **abstract class as the token** (recommended, zero ceremony) or a
  **symbol/string token with `@Inject(TOKEN)`**.

Fallback for people who refuse legacy decorators: every decorator also has a plain function
form (`inject(Token)` inside constructors, `defineController(...)`). This is a phase-2 nicety,
not phase-1 scope.

### 2.2a Modules are objects, not decorated classes (decided 2026-11-08)

Nest's `@Module()` sits on an empty class that exists only to carry metadata, and its
`{ provide, useClass }` objects are not type-checked. Suku instead uses:

```ts
export const UsersModule = defineModule({
  name: 'users',
  controllers: [UsersController],
  services: [singleton(UsersService), scoped(UnitOfWork), value(CONFIG, cfg)],
});
export const ConfigModule = (schema: Schema) => defineModule({ ... });   // replaces forRoot()
const app = await Suku.create({ imports: [UsersModule], adapter: nodeAdapter() }); // inline root
```

`singleton/scoped/transient/value/factory/alias` live in `@suku/di` and check the
implementation against the token (`NoInfer` keeps inference on the token side). `@Module`
on a class remains as an alias for migrating code. Decorators stay where they earn their
place: controllers, routes, parameters, `@Injectable`.

### 2.2 DI model: flat collection, Nest-shaped registration

NestJS gives every module its own injector and enforces `exports`. .NET has one flat
container. These conflict, and the module-scoped injector is the heaviest part of Nest.

Decision: **modules are a registration and organisation unit; resolution is one flat
`ServiceProvider`.** `@Module({ providers })` registers into the single collection.
`exports` is accepted and recorded but not enforced in v1. Enforcement (a module cannot
inject what its imports did not export) is an opt-in `strictModules: true` flag planned
for v2, implemented as a build-time validation pass, not a runtime cost.

### 2.3 Lifetimes and scopes (straight from .NET)

| Lifetime    | Behaviour                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `singleton` | One instance per root provider. Created lazily on first resolve (or eagerly with `validateOnBuild`).     |
| `scoped`    | One instance per scope. The HTTP layer creates one scope per request and disposes it after the response. |
| `transient` | New instance on every resolve.                                                                           |

Registration API mirrors `IServiceCollection`:

```ts
services.addSingleton(Logger); // class as its own token
services.addSingleton(Cache, RedisCache); // abstract class token -> impl
services.addScoped(UnitOfWork);
services.addTransient(TOKEN, (sp) => new Thing(sp.get(Logger))); // factory
services.addSingleton(CONFIG, { useValue: cfg }); // instance
services.addKeyedSingleton(Storage, 's3', S3Storage); // .NET 8 keyed services
```

Resolution API mirrors `IServiceProvider`:

```ts
const root = services.build({ validateScopes: true, validateOnBuild: true });
root.get(Logger); // throws if missing
root.getOptional(Logger); // undefined if missing
root.getAll(Plugin); // IEnumerable<T> equivalent
root.getKeyed(Storage, 's3');
const scope = root.createScope();
scope.get(UnitOfWork);
await scope.dispose(); // calls [Symbol.asyncDispose] / dispose() on owned instances
```

Validations done at `build()` time, exactly like .NET:

- captive dependencies (a singleton depending on a scoped service) when `validateScopes` is on
- circular constructor dependencies (reported as a chain `A -> B -> A`)
- missing registrations (when `validateOnBuild` is on)

Resolving a scoped service from the root provider throws, as in .NET.

### 2.4 HTTP layer: web standards first

Decision: the kernel speaks **Fetch `Request` / `Response`**. A platform adapter is a
single function `(req: Request) => Promise<Response>` plus a `listen()`.

- `@suku/platform-node`: wraps `node:http`, converts `IncomingMessage` to `Request` with a
  streaming body, writes the `Response` back. This is the only piece with Node-specific code.
- `@suku/platform-bun`: `Bun.serve({ fetch })`, basically a one-liner.
- Deno and Cloudflare Workers get adapters later for free because they are already fetch-native.

Router: radix tree, static > param > wildcard precedence, zero dependencies.

### 2.5 Request pipeline (Nest's order, Nest's names)

```
Middleware -> Guards -> Interceptors (before) -> Pipes -> Handler
          -> Interceptors (after) -> Exception filters -> Response
```

Interceptors use plain `async (ctx, next) => Response` instead of RxJS observables.
Everything is a class with one method so it can be injected like any other service, or a
bare function for the quick cases.

### 2.6 Validation: Standard Schema, no hard dependency

Pipes accept anything implementing the Standard Schema spec (`~standard`), so Zod, Valibot,
ArkType and Effect Schema work with no adapter code and no dependency in Suku itself.
`@Body(UserSchema)` validates and infers the type.

### 2.7 What is deliberately out of v1

Microservices transport, WebSockets, GraphQL, a CLI generator, ORM integration, OpenAPI
generation, hot reload. Each can be a separate package later. Keeping them out is what
makes the size target reachable.

## 3. Target developer experience

```ts
// users.service.ts
@Injectable()
export class UsersService {
  constructor(
    private readonly db: Database,
    private readonly log: Logger,
  ) {}
  find(id: string) {
    return this.db.users.get(id);
  }
}

// users.controller.ts
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  getOne(@Param('id') id: string) {
    const user = this.users.find(id);
    if (!user) throw new NotFoundException();
    return user; // plain object -> JSON 200
  }

  @Post()
  @UseGuards(AuthGuard)
  create(@Body(CreateUserSchema) dto: CreateUser) {
    return this.users.create(dto);
  }
}

// users.module.ts
export const UsersModule = defineModule({
  name: 'users',
  controllers: [UsersController],
  services: [singleton(UsersService), scoped(Database, PgDatabase)],
});

// main.ts
const app = await Suku.create({ imports: [UsersModule], adapter: nodeAdapter() });
app.useGlobalFilters(HttpExceptionFilter);
await app.listen(3000);
```

Provider objects accept `lifetime: 'singleton' | 'scoped' | 'transient'` (default singleton,
same as Nest and .NET's typical usage).

## 4. Repository layout

Bun workspaces monorepo. One repo, several small publishable packages so the DI container
can be used on its own.

```
suku/
  packages/
    di/              @suku/di          container, decorators, metadata shim   (no deps)
    core/            @suku/core        modules, controllers, router, pipeline  (depends on di)
    platform-node/   @suku/platform-node
    platform-bun/    @suku/platform-bun
    testing/         @suku/testing     createTestingModule, overrideProvider
  examples/
    hello/
    realworld/       a small CRUD app used for benchmarks and docs
  benchmarks/        autocannon scripts vs raw node:http, Fastify, NestJS
  docs/
  package.json       bun workspaces, shared scripts
  tsconfig.base.json experimentalDecorators + emitDecoratorMetadata, strict, ES2022, NodeNext
```

Tooling: Bun for workspace/test runner (`bun test` works on Node-targeted code too),
`tsdown` for building ESM + CJS + `.d.ts`, Biome for lint and format, GitHub Actions
running tests on Node 22 and Bun, size-limit check in CI against the 40 KB budget.

## 5. Phases

Each phase ends with passing tests and a runnable example. Phases 1 and 2 are independent
and can be built in parallel.

### Phase 0 — Bootstrap (half a day) — DONE 2026-11-08

- Bun workspace, base tsconfig, Biome, tsdown build, `bun test`, CI workflow, size-limit.
- Done when: `bun run build && bun test` is green on an empty package.

### Phase 1 — `@suku/di` (the heart, ~3 days) — DONE 2026-11-08 (43 tests, 12.5 KB minified)

1. Metadata shim: `Reflect.metadata`, `Reflect.getMetadata`, `Reflect.getOwnMetadata`.
2. Decorators: `@Injectable()`, `@Inject(token, key?)`, `@Optional()`.
3. `ServiceCollection`: add/addSingleton/addScoped/addTransient/addKeyed*, tryAdd*, remove, replace.
4. Provider descriptors: class, factory, value, alias (`useExisting`).
5. `ServiceProvider`: get/getOptional/getAll/getKeyed, constructor resolution from
   `design:paramtypes`, resolution-chain tracking for error messages.
6. Scopes: `createScope()`, scoped cache, root-scope guard, `dispose()` with
   `Symbol.dispose` / `Symbol.asyncDispose` / `onDispose()` support, LIFO disposal order.
7. Build-time validation: captive dependency, cycle detection, missing registration.
8. Tests: every lifetime matrix cell, disposal order, keyed services, error messages.

- Done when: the container passes a port of the relevant .NET `ServiceProvider` spec tests
  and has zero dependencies.

### Phase 2 — HTTP kernel (~2 days) — DONE 2026-11-08 (see benchmark note below)

1. `Adapter` interface: `{ handle(req: Request): Promise<Response>; listen(port) ; close() }`.
2. Radix router with param and wildcard segments, method dispatch, 404/405 handling.
3. `@suku/platform-node`: IncomingMessage → Request (streaming body, headers, URL), Response → ServerResponse (streams, keep-alive), graceful close.
4. `@suku/platform-bun`.
5. Benchmark harness in `benchmarks/` so overhead is measured from day one.

- Done when: a hand-wired route serves JSON on both Node and Bun within the overhead budget.
- Benchmark note (2026-11-08, M-series laptop, autocannon 64 connections, `/users/:id`):
  raw `node:http` 75-94k req/s, Suku node adapter 45-53k (about half); raw `Bun.serve` 110-113k,
  Suku bun adapter 115-122k (parity). The original "< 10% overhead on Node" target is not
  reachable with real Fetch `Request`/`Response` objects: a CPU profile shows the cost spread
  across undici's Request construction, Response construction and body streams rather than in
  one hot spot. A body fast path (writing the Response's original string/bytes with a
  Content-Length) is in place. Remaining lever for later: a lazily constructed Request, as
  `@hono/node-server` does, estimated to recover 10-15%. Target revised to >= 50% of raw on
  Node, parity on Bun.
- Full-framework numbers (same run, after Phase 3): `suku app (node)` 47k vs raw 77k (-39%),
  `suku app (bun)` 113k vs raw 112k (parity). Modules, per-request DI scope, controller
  resolution, parameter extraction and JSON serialisation together add about 2% over the
  bare adapter.
- Node cannot execute legacy decorators or emit decorator metadata on its own, so apps are
  compiled with `tsc` or bundled with `bun build --target node` before running on Node.
  Bun runs the TypeScript sources directly.

### Phase 3 — Modules, controllers, bootstrap (~3 days) — DONE 2026-11-08 (32 tests; full app within 2% of the bare adapter on Node, parity with raw Bun.serve on Bun)

1. `@Module()` metadata; recursive import walk; registration of providers and controllers into one `ServiceCollection`; duplicate-import deduplication.
2. `@Controller(prefix)`, `@Get/@Post/@Put/@Patch/@Delete/@Head/@Options/@All(path)`.
3. Param decorators: `@Param`, `@Query`, `@Body`, `@Headers`, `@Req`, `@Res`, `@Ctx`, custom `createParamDecorator`.
4. Per-request scope: create scope → resolve controller (so controllers can be scoped or transient like .NET controllers) → invoke → dispose scope in `finally`.
5. Return-value serialisation: `Response` passthrough, object → JSON, string → text, `undefined` → 204, `@HttpCode()`, `@Header()`, `@Redirect()`.
6. `Suku.create(RootModule, opts)` → `app.listen()`, `app.close()`, `app.get(Token)`.

- Done when: the target DX in section 3 runs end to end.

### Phase 4 — Pipeline (~3 days) — DONE 2026-11-08 (pieces may be classes, instances or functions; module-level `middleware`; `@SetMetadata` + `ctx.getMetadata`; interceptors see the raw result, not a Response)

1. Middleware: global and per-module, `(ctx, next)`.
2. Guards: `canActivate(ctx)`; `@UseGuards` at class and method level; 403 on false.
3. Interceptors: `intercept(ctx, next)`; class and method level; global.
4. Pipes: `transform(value, meta)`; parameter-level and global; built-ins `ParseIntPipe`, `ParseUUIDPipe`, `DefaultValuePipe`.
5. Exception filters: `catch(err, ctx)`; `@Catch(Type)`; default filter maps `HttpException` → status + JSON body, unknown → 500 with a logged stack.
6. `HttpException` hierarchy: BadRequest, Unauthorized, Forbidden, NotFound, Conflict, UnprocessableEntity, TooManyRequests, InternalServerError.
7. Execution context carries `Request`, route metadata, handler and class refs, the request scope, and a `set/get` state bag.

- Done when: a guard, interceptor, pipe and filter each have a test proving order of execution matches section 2.5.

### Phase 5 — Validation, body parsing, config (~2 days) — DONE 2026-11-08 (`defineConfig(name, schema)` + `Env.load()` instead of `ConfigModule.forRoot`; `ctx.body()`; zod used only in tests and the example)

1. Body parsing by content-type: JSON, urlencoded, multipart (fields and files as `File`), text, raw stream. Size limits with 413.
2. `ValidationPipe` built on Standard Schema; `@Body(schema)`, `@Query(schema)`, `@Param(schema)` sugar; 400 with structured issues.
3. `ConfigModule.forRoot({ schema })`: loads `process.env`, validates with a Standard Schema, exposes a typed `Config` singleton.
4. `Logger` abstract class with a console default, injectable and replaceable.

- Done when: an invalid body returns a 400 with field-level issues, and config fails fast on a bad env.

### Phase 6 — Lifecycle and shutdown (~1 day)

1. Hooks: `onModuleInit`, `onApplicationBootstrap`, `onApplicationShutdown(signal)`, called in dependency order.
2. `app.enableShutdownHooks()`: SIGTERM/SIGINT → stop accepting, drain in-flight, dispose root provider.

- Done when: an integration test shows in-flight requests complete and singletons dispose on SIGTERM.

### Phase 7 — `@suku/testing` (~1 day)

1. `Test.createTestingModule({ imports, providers }).overrideProvider(X).useValue(y).compile()`.
2. `app.inject({ method, url, body })` in-process requests without a socket (just call `handle(Request)`).

- Done when: the example app's controllers have tests that need no network.

### Phase 8 — Docs, benchmarks, release (~2 days)

1. Benchmarks vs raw node:http, Fastify, NestJS on Express and Fastify; publish numbers.
2. README per package, a "coming from NestJS" and a "coming from .NET" guide.
3. Changesets, `0.1.0` to npm under the `@suku` scope.

## 6. Risks and how the plan handles them

- **Legacy decorators are "legacy".** TypeScript still ships them and has no removal plan.
  The function-form API (section 2.1) is the escape hatch; it is additive, so deferring it is safe.
- **Streaming bodies on Node.** Converting `IncomingMessage` to a `Request` with a
  `ReadableStream` is the fiddliest adapter code. Phase 2 benchmarks it before anything is built on it.
- **Per-request scope cost.** Creating a scope and a scoped cache per request must be cheap:
  the scope is a plain object with one `Map`, allocated lazily on first scoped resolve.
- **Module `exports` not enforced in v1.** Flagged in docs as a known difference from Nest;
  the v2 strict mode is a validation pass with no runtime cost.

## 7. Open questions to settle before Phase 3

1. Package name: `@suku/*` on npm, or a single `suku` package with subpath exports? The
   monorepo layout supports either; the scope just needs claiming.
2. Default controller lifetime: singleton (Nest default, fastest) or scoped (.NET default,
   lets controllers hold request state). Plan assumes singleton with opt-in `lifetime: 'scoped'`.
3. Should `getAll()` return registration order (.NET) or allow a `priority` on providers?
