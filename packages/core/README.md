# @suku/core

Routes, features and middlewares on a .NET-style container.

```ts
import { Routes, Suku, feature, route, singleton } from '@suku/core';
import { z } from 'zod';

@Routes('/users')
class UsersRoutes {
  constructor(private readonly users: UsersService) {}

  findOne = route.get('/:id', {
    params: z.object({ id: z.coerce.number() }),
    handle: ({ params }) => this.users.find(params.id),
  });
}

// Or without a class: the route declares its services.
const health = route.get('/health', { services: { db: Database }, handle: ({ db }) => db.ping() });

const UsersFeature = feature('users', {
  routes: [UsersRoutes],
  services: [singleton(UsersService)],
});
const app = await Suku.create({ features: [UsersFeature], routes: [health], adapter });
```

- **Routes** are typed objects from `route.get/post/...`. `params`, `query`, `body`, `headers`
  and `response` take any Standard Schema; they validate at runtime and type the handler. The
  path literal is checked against the `params` schema at compile time.
- **`@Routes` classes** hold routes as fields and receive services through the constructor.
  Singleton by default; the class is constructed once at startup to discover its routes.
- **Features** bundle routes, services and middlewares. `prefix`, `middlewares` and `onError`
  apply to a feature's own routes. All services share one flat container.
- **Middlewares** are the one cross-cutting concept: `(ctx, next) => Response`. Functions,
  instances, or classes built through the container. Order: app, feature, class or group, route.
- **Errors**: throw `HttpException` subclasses; map others with `onError` at any level.
- **Config**: `defineConfig(name, schema)`, then `Env.load()` as a feature.
- **Testing**: `app.handle(new Request(...))` runs a request in process.

Classes that use constructor injection need `experimentalDecorators` and
`emitDecoratorMetadata`, or a `static inject = [...]` array. Linter rules that rewrite imports
to `import type` (Biome `useImportType`, ESLint `consistent-type-imports`) break constructor
injection and must be off.
