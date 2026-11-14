import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { HttpServer } from '@sukujs/core';
import { bunAdapter } from '../src/index.js';

let server: HttpServer;

beforeAll(async () => {
  server = await bunAdapter({ onError: () => new Response('custom 500', { status: 500 }) }).serve(
    async (req, info) => {
      const url = new URL(req.url);
      if (url.pathname === '/echo')
        return new Response(await req.text(), { headers: { 'x-m': req.method } });
      if (url.pathname === '/throw') throw new Error('boom');
      if (url.pathname === '/ip') return Response.json({ ip: info?.remoteAddress });
      return Response.json({ path: url.pathname });
    },
    { port: 0, hostname: '127.0.0.1' },
  );
});

afterAll(async () => {
  await server.close({ force: true });
});

describe('bunAdapter', () => {
  test('serves JSON and reports its url', async () => {
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    const res = await fetch(`${server.url}/x`);
    expect(await res.json()).toEqual({ path: '/x' });
  });

  test('echoes request bodies', async () => {
    const res = await fetch(`${server.url}/echo`, { method: 'POST', body: 'hello' });
    expect(res.headers.get('x-m')).toBe('POST');
    expect(await res.text()).toBe('hello');
  });

  test('handler errors go through onError', async () => {
    const res = await fetch(`${server.url}/throw`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('custom 500');
  });

  test('close() stops the server', async () => {
    const s = await bunAdapter().serve(() => new Response('x'), { port: 0, hostname: '127.0.0.1' });
    expect((await fetch(s.url)).status).toBe(200);
    await s.close({ force: true });
    await expect(fetch(s.url)).rejects.toThrow();
  });
});

test('passes the peer address to the handler', async () => {
  const res = await fetch(`${server.url}/ip`);
  expect(((await res.json()) as { ip: string }).ip).toMatch(/127\.0\.0\.1/);
});
