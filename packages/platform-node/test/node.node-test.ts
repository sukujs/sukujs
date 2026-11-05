// Runs on real Node via `node --test`, not under Bun: the adapter wraps node:http and must
// be exercised against Node's own Request/Response implementation.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { HttpServer } from '@suku/core';
import { getNodeRaw, nodeAdapter } from '../src/index.ts';

let server: HttpServer;
let seenRaw = false;

before(async () => {
  server = await nodeAdapter({ onError: () => new Response('custom 500', { status: 500 }) }).serve(
    async (req) => {
      const url = new URL(req.url);
      seenRaw ||= getNodeRaw(req) !== undefined;
      switch (url.pathname) {
        case '/json':
          return Response.json({ ok: true, q: url.searchParams.get('q') });
        case '/echo':
          return new Response(await req.text(), {
            headers: {
              'content-type': req.headers.get('content-type') ?? 'text/plain',
              'x-method': req.method,
            },
          });
        case '/cookies': {
          const h = new Headers();
          h.append('set-cookie', 'a=1');
          h.append('set-cookie', 'b=2; Path=/');
          return new Response(null, { status: 204, headers: h });
        }
        case '/stream': {
          const enc = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            async start(c) {
              for (const chunk of ['one ', 'two ', 'three']) {
                c.enqueue(enc.encode(chunk));
                await new Promise((r) => setTimeout(r, 5));
              }
              c.close();
            },
          });
          return new Response(stream, { headers: { 'content-type': 'text/plain' } });
        }
        case '/string':
          return new Response('héllo');
        case '/bytes':
          return new Response(new Uint8Array([1, 2, 3]));
        case '/locked': {
          const r = new Response('x');
          r.body!.getReader();
          return new Response('fallback');
        }
        case '/blob':
          return new Response(new Blob(['blob']));
        case '/throw':
          throw new Error('boom');
        default:
          return new Response('not found', { status: 404, statusText: 'Nope' });
      }
    },
    { port: 0, hostname: '127.0.0.1' },
  );
});

after(async () => {
  await server.close({ force: true });
});

describe('nodeAdapter', () => {
  test('binds a free port and reports its url', () => {
    assert.ok(server.port > 0);
    assert.equal(server.url, `http://127.0.0.1:${server.port}`);
  });

  test('GET with query, JSON response, raw access', async () => {
    const res = await fetch(`${server.url}/json?q=hi`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await res.json(), { ok: true, q: 'hi' });
    assert.equal(seenRaw, true);
  });

  test('request bodies stream through for POST and PUT', async () => {
    const res = await fetch(`${server.url}/echo`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    assert.equal(res.headers.get('x-method'), 'PUT');
    assert.deepEqual(await res.json(), { a: 1 });
  });

  test('multiple set-cookie headers and 204 without body', async () => {
    const res = await fetch(`${server.url}/cookies`);
    assert.equal(res.status, 204);
    assert.deepEqual(res.headers.getSetCookie(), ['a=1', 'b=2; Path=/']);
    assert.equal(await res.text(), '');
  });

  test('HEAD sends headers only', async () => {
    const res = await fetch(`${server.url}/json`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
  });

  test('streaming response bodies', async () => {
    const res = await fetch(`${server.url}/stream`);
    assert.equal(res.headers.get('transfer-encoding'), 'chunked');
    assert.equal(await res.text(), 'one two three');
  });

  test('fast path: string and byte bodies get a Content-Length and arrive intact', async () => {
    let res = await fetch(`${server.url}/string`);
    assert.equal(res.headers.get('content-length'), '6');
    assert.equal(await res.text(), 'héllo');
    res = await fetch(`${server.url}/bytes`);
    assert.equal(res.headers.get('content-length'), '3');
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([1, 2, 3]));
    res = await fetch(`${server.url}/json`);
    assert.ok(res.headers.get('content-length'));
    assert.deepEqual(await res.json(), { ok: true, q: null });
  });

  test('fallback: locked and blob bodies still work', async () => {
    assert.equal(await (await fetch(`${server.url}/locked`)).text(), 'fallback');
    assert.equal(await (await fetch(`${server.url}/blob`)).text(), 'blob');
  });

  test('status text and 404 pass through', async () => {
    const res = await fetch(`${server.url}/nowhere`);
    assert.equal(res.status, 404);
    assert.equal(res.statusText, 'Nope');
  });

  test('handler errors go through onError', async () => {
    const res = await fetch(`${server.url}/throw`);
    assert.equal(res.status, 500);
    assert.equal(await res.text(), 'custom 500');
  });

  test('close() stops accepting connections', async () => {
    const s = await nodeAdapter().serve(() => new Response('x'), {
      port: 0,
      hostname: '127.0.0.1',
    });
    assert.equal((await fetch(s.url)).status, 200);
    await s.close();
    await assert.rejects(fetch(s.url));
  });
});
