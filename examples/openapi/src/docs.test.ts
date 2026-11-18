import { expect, test } from 'bun:test';
import { Suku } from '@sukujs/core';
import { AppFeature } from './app.feature';

const app = await Suku.create({ features: [AppFeature] });
const get = (path: string) => app.handle(new Request(`http://test${path}`));
const document = (await (await get('/openapi.json')).json()) as {
  info: { title: string };
  paths: Record<string, Record<string, any>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
  security: unknown;
};

test('the document lists the app, without its own routes', () => {
  expect(document.info.title).toBe('Books API');
  expect(Object.keys(document.paths).sort()).toEqual([
    '/books',
    '/books/{id}',
    '/health',
    '/hello/{name}',
  ]);
});

test('schemas become parameters, bodies and shared components', () => {
  const list = document.paths['/books']!.get;
  expect(list.parameters.map((p: { name: string }) => p.name)).toEqual(['author', 'limit']);
  expect(list.responses[200].content['application/json'].schema).toEqual({
    type: 'array',
    items: { $ref: '#/components/schemas/Book' },
  });
  expect(
    document.paths['/books']!.post.requestBody.content['application/json'].schema.required,
  ).toEqual(['title', 'author']);
  expect(document.components.schemas.Book).toBeDefined();
});

test('routes are locked by default, and public where they say so', () => {
  expect(document.security).toEqual([{ bearer: [] }]);
  expect(document.paths['/books']!.get.security).toEqual([]);
  expect(document.paths['/books']!.post.security).toBeUndefined();
  expect(Object.keys(document.paths['/books/{id}']!.delete.responses)).toEqual([
    '204',
    '400',
    '401',
    '404',
  ]);
});

test('what the document says is what the app does', async () => {
  expect(((await (await get('/books?limit=1')).json()) as unknown[]).length).toBe(1);
  expect((await get('/books/99')).status).toBe(404);
  const post = (headers: Record<string, string>) =>
    app.handle(
      new Request('http://test/books', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ title: 'Persuasion', author: 'Jane Austen' }),
      }),
    );
  expect((await post({})).status).toBe(401);
  const created = await post({ authorization: 'Bearer anything' });
  expect(created.status).toBe(201);
  expect(await created.json()).toEqual({ id: 3, title: 'Persuasion', author: 'Jane Austen' });
});

test('GET /docs is Scalar, under its own Content-Security-Policy', async () => {
  const response = await get('/docs');
  expect(await response.text()).toContain('Scalar.createApiReference');
  expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
});
