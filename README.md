<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/suku-logo-dark.svg">
    <img src="brand/suku-logo.svg" alt="Suku" height="48">
  </picture>
</p>

# Suku

**Room to spare.**

A lightweight TypeScript backend framework built from four ideas: **routes**, **features**,
**middlewares** and **services**. Routes are typed by their schemas, and services come from a
dependency injection container modelled on .NET's. Zero runtime dependencies. Runs on Node and Bun.

```ts
import { Routes, Suku, feature, route, singleton } from '@suku/core';
import { nodeAdapter } from '@suku/platform-node';
import { z } from 'zod';

class UsersService {
  find(id: number) {
    return { id, name: 'Ada' };
  }
}

@Routes('/users')
class UsersRoutes {
  constructor(private readonly users: UsersService) {}

  findOne = route.get('/:id', {
    params: z.object({ id: z.coerce.number() }),
    handle: ({ params }) => this.users.find(params.id), // params.id is a number
  });
}

const UsersFeature = feature('users', {
  routes: [UsersRoutes],
  services: [singleton(UsersService)],
});

const app = await Suku.create({ features: [UsersFeature], adapter: nodeAdapter() });
await app.listen(3000);
```

Prefer no classes? A route can declare the services it needs instead:

```ts
const findOne = route.get('/users/:id', {
  params: z.object({ id: z.coerce.number() }),
  services: { users: UsersService },
  handle: ({ params, users }) => users.find(params.id),
});
```

## What makes it different

- **Types written once.** A route's schemas validate the request and type the handler. The path
  literal is checked against the `params` schema at compile time.
- **Two styles, one primitive.** Routes as fields of an injected class, or as plain values.
- **DI like .NET.** One flat service collection, explicit lifetimes, a scope per request,
  captive-dependency and cycle detection at startup, disposal in reverse order.
- **One cross-cutting concept.** Everything that wraps a request is a middleware.
- **Web-standard core.** The kernel speaks Fetch `Request`/`Response`; Bun runs at parity with raw `Bun.serve`.
- **Validation via Standard Schema.** Zod, Valibot or ArkType, with no adapter.

## Packages

| Package               | What it is                                                                          |
| --------------------- | ----------------------------------------------------------------------------------- |
| `@suku/core`          | Routes, features, middlewares, validation, config, logger                           |
| `@suku/di`            | Container: lifetimes, scopes, keyed services, disposal, build-time validation       |
| `@suku/crypto`        | JWT, password hashing, signed and encrypted values, random tokens. Works on its own |
| `@suku/security`      | CORS, security headers, CSRF protection and rate limiting, as middlewares           |
| `@suku/platform-node` | `node:http` adapter                                                                 |
| `@suku/platform-bun`  | `Bun.serve` adapter                                                                 |

## Development

```bash
bun install
bun run check        # lint, typecheck, tests (Bun + Node), build, size budgets
bun run docs:dev     # documentation site
bun run --cwd examples/hello dev
```

Documentation lives in [apps/docs](apps/docs). See [PLAN.md](PLAN.md) for design decisions.

## License

MIT
