import { expect, test } from 'bun:test';
import { createApp } from '../src/app.js';

const make = (source: Record<string, unknown> = {}) => createApp({ runtime: 'test', source });
const url = (path: string) => `http://deploy.test${path}`;
const post = (path: string, body: unknown) =>
  new Request(url(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('health, readiness and info', async () => {
  const app = await make({ APP_VERSION: '1.2.3' });
  expect(await (await app.handle(new Request(url('/health')))).json()).toEqual({ status: 'ok' });
  expect((await app.handle(new Request(url('/ready')))).status).toBe(200);
  const info = await (await app.handle(new Request(url('/info')))).json();
  expect(info).toMatchObject({ runtime: 'test', version: '1.2.3' });
  expect(info.instance).toHaveLength(8);
});

test('configuration reaches a route', async () => {
  const app = await make({ GREETING: 'Salam' });
  const response = await app.handle(new Request(url('/hello/Ada')));
  expect(await response.json()).toEqual({ message: 'Salam, Ada' });
});

test('invalid configuration stops the app from starting', async () => {
  expect(make({ PORT: 'not-a-port' })).rejects.toThrow('Invalid configuration');
});

test('whoami trusts X-Forwarded-For only when told a proxy is there', async () => {
  const request = () =>
    new Request(url('/whoami'), { headers: { 'x-forwarded-for': '203.0.113.9' } });
  const direct = await (
    await (await make()).handle(request(), { remoteAddress: '10.0.0.1' })
  ).json();
  expect(direct).toMatchObject({ ip: '10.0.0.1', peer: '10.0.0.1', host: 'deploy.test' });

  const proxied = await make({ TRUST_PROXY: '1' });
  const seen = await (await proxied.handle(request(), { remoteAddress: '10.0.0.1' })).json();
  expect(seen).toMatchObject({ ip: '203.0.113.9', peer: '10.0.0.1' });
});

test('echo validates its body', async () => {
  const app = await make();
  expect(await (await app.handle(post('/echo', { message: 'hi' }))).json()).toEqual({
    echo: 'hi',
    length: 2,
  });
  expect((await app.handle(post('/echo', { message: '' }))).status).toBe(400);
});

test('the sixth request in a minute is rejected', async () => {
  const app = await make();
  const hit = () => app.handle(new Request(url('/limited')), { remoteAddress: '10.0.0.7' });
  for (let i = 0; i < 5; i++) expect((await hit()).status).toBe(200);
  expect((await hit()).status).toBe(429);
  // Another client has its own count.
  const other = await app.handle(new Request(url('/limited')), { remoteAddress: '10.0.0.8' });
  expect(other.status).toBe(200);
});

test('slow waits, and hash verifies', async () => {
  const app = await make();
  expect(await (await app.handle(new Request(url('/slow?ms=10')))).json()).toEqual({
    waitedMs: 10,
  });
  const hashed = await (await app.handle(post('/hash', { password: 'correct horse' }))).json();
  expect(hashed.verified).toBe(true);
});

test('security headers are on every response', async () => {
  const app = await make();
  const response = await app.handle(new Request(url('/health')));
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
