# @sukujs/openapi

An OpenAPI 3.1 document generated from your Suku routes, served with Swagger UI, Scalar or Redoc.

```bash
bun add @sukujs/openapi
```

```ts
import { apiDoc, openapi, scalar } from '@sukujs/openapi';

@Routes('/users')
export class UsersRoutes {
  constructor(private readonly users: UsersService) {}

  findOne = route.get('/:id', {
    meta: apiDoc({ summary: 'Get a user', responses: { 404: 'No user with this id' } }),
    params: z.object({ id: z.coerce.number() }),
    response: User,
    handle: ({ params }) => this.users.find(params.id),
  });
}

const app = await Suku.create({
  features: [UsersFeature],
  routes: [openapi({ info: { title: 'Shop', version: '1.0.0' }, ui: scalar() })],
});
// GET /openapi.json   the document
// GET /docs           the UI
```

- **Nothing to repeat.** Paths, parameters, request bodies and responses come from the
  schemas the routes already validate with: `params`, `query`, `headers`, `body`, `response`.
- **`apiDoc()`** adds what a schema cannot say: summary, description, tags, extra responses,
  security, deprecation. It goes in the route's `meta` and changes no behaviour.
- **Three UIs built in**: `swaggerUi()` (default), `scalar()`, `redoc()`. Any other viewer is
  an object with a `render` function.
- **Any schema library** that implements Standard JSON Schema (Zod 4.2+, ArkType, Valibot).
  For others, pass `toJsonSchema`.
- **Named schemas are shared.** A Zod schema with `.meta({ id: 'User' })` becomes
  `components.schemas.User`.
- **A strict page.** The UI is served with a Content-Security-Policy that allows its own
  scripts and its CDN, so it works next to `securityHeaders()`.
- **`createOpenApiDocument(app.get(ROUTE_TABLE), options)`** builds the document without a
  server, to write it to a file or generate a client.

No dependencies besides `@sukujs/core`. The UIs load from a CDN at a pinned version.
