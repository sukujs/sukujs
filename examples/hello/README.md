# hello

A Suku app: typed module objects, decorated controllers, constructor-injected services,
and a request-scoped controller.

```bash
bun run dev                  # Bun
bun run start:node           # bundle with Bun, run with Node
curl localhost:3000/users/1
```

Modules are plain objects, so a parameterised module is just a function:

```ts
export const ConfigModule = (cfg: Config) => defineModule({ services: [value(CONFIG, cfg)] });
```
