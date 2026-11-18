import { describe, expect, test } from 'bun:test';
import { feature, ROUTE_TABLE, Routes, route, Service, Suku, type SukuOptions } from '@sukujs/core';
import { z } from 'zod';
import sukuOpenapi, {
  apiDoc,
  createOpenApiDocument,
  type DocsUi,
  type OpenApiDocument,
  openapi,
  redoc,
  scalar,
  swaggerUi,
} from '../src/index';

const User = z.object({ id: z.number(), name: z.string() }).meta({ id: 'User' });

@Service()
class UsersService {
  private readonly users = [{ id: 1, name: 'Ada', password: 'secret' }];
  all() {
    return this.users;
  }
  find(id: number) {
    return this.users.find((u) => u.id === id);
  }
}

@Routes('/users')
class UsersRoutes {
  constructor(private readonly users: UsersService) {}

  list = route.get('/', {
    meta: apiDoc({ summary: 'List users' }),
    query: z.object({
      limit: z.coerce.number().int().max(100).default(20).describe('Page size'),
      q: z.string().optional(),
    }),
    response: z.array(User),
    handle: () => this.users.all(),
  });

  findOne = route.get('/:id', {
    meta: apiDoc({ summary: 'Get a user', responses: { 404: 'No user with this id' } }),
    params: z.object({ id: z.coerce.number() }),
    response: User,
    handle: ({ params }) => this.users.find(params.id)!,
  });

  create = route.post('/', {
    meta: {
      roles: ['admin'],
      ...apiDoc({
        tags: ['Admin'],
        security: [{ bearer: [] }],
        responses: { 409: { description: 'Name taken', schema: z.object({ name: z.string() }) } },
      }),
    },
    headers: z.object({ 'idempotency-key': z.string() }),
    body: z.object({ name: z.string().min(2) }),
    response: User,
    handle: ({ body }) => ({ id: 2, name: body.name }),
  });

  remove = route.delete('/:id', {
    meta: apiDoc({ deprecated: true, operationId: 'deleteUser' }),
    status: 204,
    handle: () => undefined,
  });

  internal = route.get('/internal/stats', {
    meta: apiDoc({ hidden: true }),
    handle: () => ({}),
  });
}

const UsersFeature = feature('users', { routes: [UsersRoutes], services: [UsersService] });

const health = route.get('/health', { handle: () => ({ ok: true }) });
const files = route.get('/files/*path', { handle: ({ params }) => params.path });
const anything = route.all('/hook', { handle: () => 'ok' });

const create = (options: Parameters<typeof openapi>[0] = {}, app: SukuOptions = {}) =>
  Suku.create({
    features: [UsersFeature],
    routes: [health, files, anything, openapi(options)],
    ...app,
  });

const get = async (app: Awaited<ReturnType<typeof create>>, path: string) =>
  app.handle(new Request(`http://api.test${path}`));

const documentOf = async (app: Awaited<ReturnType<typeof create>>, path = '/openapi.json') =>
  (await (await get(app, path)).json()) as OpenApiDocument;

describe('the document', () => {
  const appP = create({
    info: { title: 'Shop', version: '1.2.3' },
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    tags: [{ name: 'users', description: 'People' }],
  });

  test('is OpenAPI 3.1 with the given info, and servers set to the origin of the request', async () => {
    const doc = await documentOf(await appP);
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toEqual({ title: 'Shop', version: '1.2.3' });
    expect(doc.servers).toEqual([{ url: 'http://api.test' }]);
    expect(doc.tags).toEqual([{ name: 'users', description: 'People' }]);
    expect(doc.components!.securitySchemes).toEqual({ bearer: { type: 'http', scheme: 'bearer' } });
  });

  test('lists every route once, without hidden routes, `route.all` or its own routes', async () => {
    const doc = await documentOf(await appP);
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/files/{path}',
      '/health',
      '/users',
      '/users/{id}',
    ]);
    expect(Object.keys(doc.paths['/users']!).sort()).toEqual(['get', 'post']);
    expect(Object.keys(doc.paths['/users/{id}']!).sort()).toEqual(['delete', 'get']);
  });

  test('path parameters come from the path, typed by the params schema', async () => {
    const doc = await documentOf(await appP);
    expect(doc.paths['/users/{id}']!.get!.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ]);
    // No schema: a string.
    expect(doc.paths['/users/{id}']!.delete!.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    expect(doc.paths['/files/{path}']!.get!.parameters).toEqual([
      { name: 'path', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  test('query and header schemas become parameters', async () => {
    const doc = await documentOf(await appP);
    expect(doc.paths['/users']!.get!.parameters).toEqual([
      {
        name: 'limit',
        in: 'query',
        required: false,
        description: 'Page size',
        schema: { type: 'integer', maximum: 100, minimum: -9007199254740991, default: 20 },
      },
      { name: 'q', in: 'query', required: false, schema: { type: 'string' } },
    ]);
    expect(doc.paths['/users']!.post!.parameters).toEqual([
      { name: 'idempotency-key', in: 'header', required: true, schema: { type: 'string' } },
    ]);
  });

  test('the body schema becomes the request body', async () => {
    const doc = await documentOf(await appP);
    expect(doc.paths['/users']!.post!.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 2 } },
            required: ['name'],
          },
        },
      },
    });
  });

  test('the response schema documents the success status, and named schemas are shared', async () => {
    const doc = await documentOf(await appP);
    const ref = { $ref: '#/components/schemas/User' };
    expect((doc.paths['/users/{id}']!.get!.responses as any)[200]).toEqual({
      description: 'Success',
      content: { 'application/json': { schema: ref } },
    });
    expect((doc.paths['/users']!.get!.responses as any)[200].content).toEqual({
      'application/json': { schema: { type: 'array', items: ref } },
    });
    // POST answers 201 unless the route sets a status.
    expect((doc.paths['/users']!.post!.responses as any)[201].content).toEqual({
      'application/json': { schema: ref },
    });
    expect((doc.paths['/users/{id}']!.delete!.responses as any)[204]).toEqual({
      description: 'Success',
    });
    expect(doc.components!.schemas!.User).toEqual({
      type: 'object',
      properties: { id: { type: 'number' }, name: { type: 'string' } },
      required: ['id', 'name'],
      additionalProperties: false,
    });
  });

  test('a route with input schemas documents the 400 that validation sends', async () => {
    const app = await appP;
    const doc = await documentOf(app);
    const responses = doc.paths['/users/{id}']!.get!.responses as any;
    expect(responses[400]).toEqual({ $ref: '#/components/responses/ValidationError' });
    expect((doc.paths['/health']!.get!.responses as any)[400]).toBeUndefined();

    // The documented shape is the one the app really sends.
    const body = (await (await get(app, '/users/abc')).json()) as Record<string, unknown>;
    const schema = doc.components!.schemas!.ValidationError as {
      required: string[];
      properties: object;
    };
    for (const key of schema.required) expect(body).toHaveProperty(key);
    for (const key of Object.keys(body)) expect(schema.properties).toHaveProperty(key);
  });

  test('apiDoc adds summary, tags, security, deprecation and extra responses', async () => {
    const doc = await documentOf(await appP);
    const findOne = doc.paths['/users/{id}']!.get!;
    expect(findOne.summary).toBe('Get a user');
    expect(findOne.tags).toEqual(['users']); // the feature's name
    expect(findOne.operationId).toBe('UsersRoutes_findOne');
    expect((findOne.responses as any)[404]).toEqual({
      description: 'No user with this id',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/HttpError' } } },
    });

    const created = doc.paths['/users']!.post!;
    expect(created.tags).toEqual(['Admin']);
    expect(created.security).toEqual([{ bearer: [] }]);
    expect((created.responses as any)[409]).toEqual({
      description: 'Name taken',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
            additionalProperties: false,
          },
        },
      },
    });

    const removed = doc.paths['/users/{id}']!.delete!;
    expect(removed.deprecated).toBe(true);
    expect(removed.operationId).toBe('deleteUser');
    expect(doc.paths['/health']!.get!.tags).toEqual(['app']);
  });
});

describe('options', () => {
  test('`operation` turns route meta into documentation, `transform` has the last word', async () => {
    const app = await create({
      security: [{ bearer: [] }],
      operation: (operation, route) => {
        const roles = route.config.meta?.roles as string[] | undefined;
        if (roles) operation.description = `Needs role: ${roles.join(', ')}`;
      },
      transform: (document) => ({ ...document, externalDocs: { url: 'https://example.com' } }),
    });
    const doc = await documentOf(app);
    expect(doc.security).toEqual([{ bearer: [] }]);
    expect(doc.paths['/users']!.post!.description).toBe('Needs role: admin');
    expect(doc.paths['/users']!.get!.description).toBeUndefined();
    expect(doc.externalDocs).toEqual({ url: 'https://example.com' });
  });

  test('`toJsonSchema` replaces the conversion, and a schema nobody can convert is "any"', async () => {
    const dated = route.get('/events', {
      query: z.object({ since: z.date() }), // a Date has no JSON Schema
      handle: () => [],
    });
    const plain = await Suku.create({ routes: [dated, openapi()] });
    expect((await documentOf(plain)).paths['/events']!.get!.parameters).toBeUndefined();

    const custom = await Suku.create({
      routes: [
        dated,
        openapi({
          toJsonSchema: (schema, io) =>
            z.toJSONSchema(schema as z.ZodType, { io, unrepresentable: 'any' }),
        }),
      ],
    });
    expect((await documentOf(custom)).paths['/events']!.get!.parameters).toEqual([
      { name: 'since', in: 'query', required: true, schema: {} },
    ]);
  });

  test('`servers` replaces the request origin', async () => {
    const app = await create({ servers: [{ url: 'https://api.example.com' }] });
    expect((await documentOf(app)).servers).toEqual([{ url: 'https://api.example.com' }]);
  });

  test('paths include the app prefix, and `path` moves the document', async () => {
    const app = await create({ path: '/spec.json', docs: '/reference' }, { prefix: '/api' });
    const doc = await documentOf(app, '/api/spec.json');
    expect(Object.keys(doc.paths)).toContain('/api/users/{id}');
    const html = await (await get(app, '/api/reference')).text();
    expect(html).toContain('"url":"/api/spec.json"');
    expect((await get(app, '/openapi.json')).status).toBe(404);
  });
});

describe('the UI', () => {
  test('Swagger UI by default, with a policy that allows only its own scripts', async () => {
    const app = await create({ info: { title: 'Shop <API>' } });
    const res = await get(app, '/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await res.text();
    expect(html).toContain('swagger-ui-dist@');
    expect(html).toContain('"url":"/openapi.json"');
    expect(html).toContain('<title>Shop &#60;API&#62;</title>');

    const csp = res.headers.get('content-security-policy')!;
    const nonce = /script-src 'nonce-([a-f0-9]+)'/.exec(csp)![1]!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('https://cdn.jsdelivr.net');
    // Every script on the page carries the nonce; a fresh one per response.
    expect(html.match(/<script/g)!.length).toBe(
      html.match(new RegExp(`nonce="${nonce}"`, 'g'))!.length,
    );
    const again = (await get(app, '/docs')).headers.get('content-security-policy');
    expect(again).not.toBe(csp);
  });

  test.each([
    ['scalar', scalar({ configuration: { theme: 'purple' } }), 'Scalar.createApiReference'],
    ['redoc', redoc(), 'Redoc.init'],
    ['swaggerUi', swaggerUi({ options: { persistAuthorization: true } }), 'SwaggerUIBundle'],
  ])('%s renders a page that loads the document', async (_name, ui, marker) => {
    const app = await create({ ui: ui as DocsUi });
    const html = await (await get(app, '/docs')).text();
    expect(html).toContain(marker as string);
    expect(html).toContain('/openapi.json');
  });

  test('options reach the UI, and cannot break out of the script', async () => {
    const ui = scalar({ configuration: { theme: '</script><script>alert(1)' }, version: '1.0.0' });
    const html = ui.render({ specUrl: '/openapi.json', title: 'API', nonce: 'n' });
    expect(html).toContain('@scalar/api-reference@1.0.0');
    expect(html).not.toContain('</script><script>alert(1)');
  });

  test('a custom UI is an object with `render`; `csp` and `specUrl` are overridable', async () => {
    const ui: DocsUi = { sources: [], render: ({ specUrl }) => `<a href="${specUrl}">spec</a>` };
    const app = await create({ ui, csp: false, specUrl: '/proxied/openapi.json' });
    const res = await get(app, '/docs');
    expect(await res.text()).toBe('<a href="/proxied/openapi.json">spec</a>');
    expect(res.headers.has('content-security-policy')).toBe(false);
  });

  test('`docs: false` serves the document only', async () => {
    const app = await create({ docs: false });
    expect((await get(app, '/docs')).status).toBe(404);
    expect((await get(app, '/openapi.json')).status).toBe(200);
  });
});

describe('without a server', () => {
  test('createOpenApiDocument builds the same document from the route table', async () => {
    const options = { info: { title: 'Shop', version: '1.0.0' } };
    const app = await create(options);
    const built = createOpenApiDocument(app.get(ROUTE_TABLE), options);
    const { servers: _, ...served } = await documentOf(app);
    expect(JSON.parse(JSON.stringify(built))).toEqual(served);
  });

  test('operation ids stay unique', () => {
    const config = { name: 'same', handle: () => null };
    const doc = createOpenApiDocument([
      { method: 'GET', path: '/a', name: 'same', feature: 'app', config },
      { method: 'GET', path: '/b', name: 'same', feature: 'app', config },
    ]);
    expect(doc.paths['/a']!.get!.operationId).toBe('same');
    expect(doc.paths['/b']!.get!.operationId).toBe('same_2');
  });

  test('two different schemas with one name do not overwrite each other', () => {
    const a = z.object({ a: z.string() }).meta({ id: 'Thing' });
    const b = z.object({ b: z.number() }).meta({ id: 'Thing' });
    const doc = createOpenApiDocument([
      {
        method: 'GET',
        path: '/a',
        name: 'a',
        feature: 'app',
        config: { response: a, handle: () => null },
      },
      {
        method: 'GET',
        path: '/b',
        name: 'b',
        feature: 'app',
        config: { response: b, handle: () => null },
      },
    ]);
    expect(Object.keys(doc.components!.schemas!)).toEqual(['Thing', 'Thing_2']);
    expect(
      (doc.paths['/b']!.get!.responses as any)[200].content['application/json'].schema,
    ).toEqual({
      $ref: '#/components/schemas/Thing_2',
    });
  });

  test('the default export carries the public functions', () => {
    expect(sukuOpenapi.openapi).toBe(openapi);
    expect(sukuOpenapi.apiDoc).toBe(apiDoc);
  });
});
