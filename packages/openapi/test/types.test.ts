import { expect, test } from 'bun:test';
import { apiDoc, createOpenApiDocument, openapi, type SecuritySchemes } from '../src/index';

/**
 * Checked by `tsc`, never run: each `@ts-expect-error` fails the typecheck if the line below
 * it stops being an error.
 */
export function typed(): void {
  // Every kind of scheme, and `security` naming only the declared ones.
  openapi({
    info: {
      title: 'Shop',
      version: '1.0.0',
      contact: { name: 'Team', email: 'team@example.com' },
      license: { name: 'MIT' },
      'x-logo': { url: '/logo.svg' },
    },
    servers: [{ url: 'https://{region}.example.com', variables: { region: { default: 'eu' } } }],
    tags: [{ name: 'books', externalDocs: { url: 'https://example.com' } }],
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      basic: { type: 'http', scheme: 'basic' },
      key: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'An app key' },
      oauth: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://example.com/authorize',
            tokenUrl: 'https://example.com/token',
            scopes: { 'books:write': 'Change books' },
          },
        },
      },
      oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://example.com/.well-known' },
      mtls: { type: 'mutualTLS' },
    },
    security: [{ bearer: [] }, { key: [], oauth: ['books:write'] }],
  });

  openapi({
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    // @ts-expect-error `token` is not a declared scheme
    security: [{ token: [] }],
  });

  // @ts-expect-error no schemes are declared, so none can be required
  openapi({ security: [{ bearer: [] }] });

  // @ts-expect-error an unknown kind of scheme
  openapi({ securitySchemes: { bearer: { type: 'jwt' } } });

  // @ts-expect-error `bearerFormat` only belongs to the bearer scheme
  openapi({ securitySchemes: { basic: { type: 'http', scheme: 'basic', bearerFormat: 'JWT' } } });

  // @ts-expect-error an API key needs `in` and `name`
  openapi({ securitySchemes: { key: { type: 'apiKey' } } });

  // @ts-expect-error cookies, headers and the query are the only places for an API key
  openapi({ securitySchemes: { key: { type: 'apiKey', in: 'body', name: 'key' } } });

  openapi({
    securitySchemes: {
      oauth: {
        type: 'oauth2',
        flows: {
          // @ts-expect-error an authorization code flow needs a token URL
          authorizationCode: { authorizationUrl: 'https://example.com', scopes: {} },
        },
      },
    },
  });

  // @ts-expect-error a misspelled field of `info`
  openapi({ info: { titel: 'Shop' } });

  // @ts-expect-error a licence needs a name
  openapi({ info: { license: { url: 'https://example.com' } } });

  // @ts-expect-error a tag needs a name
  openapi({ tags: [{ description: 'Books' }] });

  // @ts-expect-error a server needs a url
  openapi({ servers: [{ description: 'Production' }] });

  // The same checks without a server.
  createOpenApiDocument([], {
    securitySchemes: { key: { type: 'mutualTLS' } },
    // @ts-expect-error `token` is not a declared scheme
    security: [{ token: [] }],
  });

  // A route names its schemes once the names are given.
  const schemes = { bearer: { type: 'http', scheme: 'bearer' } } satisfies SecuritySchemes;
  type Scheme = keyof typeof schemes;
  openapi({ securitySchemes: schemes, security: [{ bearer: [] }] });
  apiDoc<Scheme>({ security: [{ bearer: [] }] });
  apiDoc<Scheme>({ security: [] });
  // @ts-expect-error `token` is not one of the app's schemes
  apiDoc<Scheme>({ security: [{ token: [] }] });
  // @ts-expect-error a misspelled field
  apiDoc({ sumary: 'List books' });
  // @ts-expect-error a response needs a description
  apiDoc({ responses: { 404: { schema: {} } } });
}

test('the options are checked by the compiler', () => {
  expect(typeof typed).toBe('function');
});
