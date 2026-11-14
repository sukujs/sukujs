# @suku/di

Zero-dependency dependency injection for TypeScript with .NET-style lifetimes.

```ts
import { Service, Inject, InjectionToken, ServiceCollection } from '@suku/di';

abstract class Cache {
  abstract get(k: string): unknown;
}

@Service()
class RedisCache extends Cache {
  get(k: string) {
    /* ... */
  }
}

const CONFIG = new InjectionToken<{ port: number }>('CONFIG');

@Service()
class Server {
  constructor(
    private cache: Cache,
    @Inject(CONFIG) private cfg: { port: number },
  ) {}
}

const root = new ServiceCollection()
  .addSingleton(Cache, RedisCache)
  .addSingleton(CONFIG, { useValue: { port: 3000 } })
  .addScoped(Server)
  .build({ validateOnBuild: true });

const scope = root.createScope();
scope.get(Server);
await scope.dispose();
```

## Without a class

```ts
const Clock = service('clock', () => ({ now: () => new Date() }));
const Invoices = service('invoices', {
  lifetime: 'scoped',
  services: { clock: Clock },
  create: ({ clock }) => ({ dueAt: () => clock.now() }),
});

new ServiceCollection().addRange([Clock, Invoices]).build().createScope().get(Invoices);
```

`@Service()` is only needed on classes whose constructor takes parameters; a `static inject = [...]`
array is the decorator-free alternative.

## Lifetimes

| Lifetime    | Instances                                               |
| ----------- | ------------------------------------------------------- |
| `singleton` | one per root provider                                   |
| `scoped`    | one per `createScope()`; resolving from the root throws |
| `transient` | one per resolve                                         |

## Compiler settings

Constructor injection by type needs TypeScript's legacy decorators:

```json
{ "experimentalDecorators": true, "emitDecoratorMetadata": true }
```

Interfaces do not exist at runtime. Use an abstract class as the token, or an
`InjectionToken` with `@Inject(TOKEN)`.

## Validation

- `validateScopes` (default on): a singleton that pulls in a scoped service throws.
- `validateOnBuild` (default off): missing registrations, cycles, captive dependencies and
  unresolvable constructor parameters fail at `build()` instead of at first use.

## Disposal

Instances created by the container that expose `dispose()`, `onDispose()`,
`[Symbol.dispose]` or `[Symbol.asyncDispose]` are disposed, newest first, when their
owning provider is disposed. `useValue` instances are never disposed. Providers support
`await using`.
