import { feature, route } from '@sukujs/core';
import { openapi } from '@sukujs/openapi';
import { BooksFeature } from './books/books.feature';
import { HelloFeature } from './hello/hello.feature';

export const health = route.get('/health', {
  handle: () => ({ status: 'ok' }),
});

/** The root feature. `suku generate feature` and `resource` add theirs to `imports`. */
export const AppFeature = feature('app', {
  imports: [HelloFeature, BooksFeature],
  routes: [
    health,
    // GET /openapi.json is the document, GET /docs shows it. To try another UI, pass
    // `ui: scalar()` or `ui: redoc()`, both from '@sukujs/openapi'.
    openapi({
      info: {
        title: 'Books API',
        version: '1.0.0',
        description: 'An example of `@sukujs/openapi`: the document comes from the routes.',
      },
      tags: [
        { name: 'books', description: 'The catalogue' },
        { name: 'hello', description: 'A greeting' },
      ],
      // "Authorize" in the UI asks for this token and sends it with each request.
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer' },
      },
      security: [{ bearer: [] }],
    }),
  ],
});
