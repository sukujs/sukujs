import { expect, test } from 'bun:test';
import { Suku } from '@sukujs/core';
import { AppFeature } from './app.feature';

// No adapter and no port: app.handle runs a request through the whole app in process.
const app = await Suku.create({ features: [AppFeature] });
const get = (path: string) => app.handle(new Request(`http://test${path}`));

test('GET /health', async () => {
  const response = await get('/health');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('GET /hello/:name', async () => {
  expect(await (await get('/hello/Ada')).json()).toEqual({ message: 'Hello, Ada!' });
});
