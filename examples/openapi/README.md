# OpenAPI example

A small API that documents itself with [`@sukujs/openapi`](../../packages/openapi). It was
created with `suku new openapi --runtime bun --openapi scalar`, then given a `books` feature.

```bash
bun run dev      # http://localhost:3000
bun run test
```

| URL                    | What it is               |
| ---------------------- | ------------------------ |
| `/docs`                | Scalar                   |
| `/openapi.json`        | The OpenAPI 3.1 document |
| `/books`, `/books/:id` | The API being documented |

## Where to look

- [`src/app.feature.ts`](src/app.feature.ts): `openapi()` with the title, tags and a bearer
  security scheme that applies to every route.
- [`src/books/books.schemas.ts`](src/books/books.schemas.ts): the Zod schemas. `Book` has an
  `id`, so it becomes `components.schemas.Book`.
- [`src/books/books.routes.ts`](src/books/books.routes.ts): each route's `params`, `query`,
  `body` and `response` become its documentation. `apiDoc()` adds the summary, the extra
  responses, and `security: []` on the public routes.
- [`src/docs.test.ts`](src/docs.test.ts): checks the document, and that the app behaves the
  way the document says.

In the UI, open **Authentication** and enter any token to call `POST /books` and
`DELETE /books/{id}`. The example accepts every bearer token; a real app would verify it.

To try another UI, pass `ui: swaggerUi()` or `ui: redoc()` to `openapi()`.

## Logs

The app logs with [pino](https://getpino.io), set up in `src/logger.ts`. Ask for `Logger` from
`@sukujs/core` in any service to write to it.

In a terminal the lines are made for reading, by [pino-pretty](https://github.com/pinojs/pino-pretty).
Anywhere else (a container, a pipe, a log file) each line is one JSON object, which is what
log collectors expect.

```bash
LOG_LEVEL=debug bun run dev    # debug, info (default), warn or error
LOG_FORMAT=json bun run dev    # force json, or pretty
```

Every line written during an OpenTelemetry span carries its `trace_id` and `span_id`, once
the app runs with an OpenTelemetry SDK. To send logs to a collector as well, add
[pino-opentelemetry-transport](https://github.com/pinojs/pino-opentelemetry-transport).

## Generate code

```bash
bunx suku generate resource products   # a CRUD feature with a test
bunx suku generate feature billing
bunx suku generate routes billing
bunx suku generate service billing
bunx suku generate middleware audit
```

## API docs

The app describes itself: `/openapi.json` is an OpenAPI 3.1 document built from the routes,
and `/docs` shows it with Scalar. Both come from `openapi()` in
`src/app.feature.ts`, from `@sukujs/openapi`.

- Parameters, bodies and responses come from each route's schemas. Give a route a
  `response` schema to document what it returns.
- `apiDoc({ summary, tags, responses })` in a route's `meta` adds the rest.
- To keep the docs out of production, list `openapi()` only when you want it served.
