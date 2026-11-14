import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import type { FetchHandler, HttpServer, PlatformAdapter, ServeOptions } from '@suku/core';

export interface NodeAdapterOptions {
  /**
   * Supplies the server instance, for HTTPS or custom `node:http` options.
   * The adapter attaches its own `request` listener.
   */
  createServer?: () => Server;
  /** Called when the handler throws. Default logs to `console.error` and answers 500. */
  onError?: (error: unknown, request: Request) => Response | Promise<Response>;
}

export interface NodeRaw {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
}

const raw = new WeakMap<Request, NodeRaw>();

/** Returns the underlying `node:http` objects for a `Request` created by this adapter. */
export function getNodeRaw(request: Request): NodeRaw | undefined {
  return raw.get(request);
}

const defaultOnError: NonNullable<NodeAdapterOptions['onError']> = (error) => {
  console.error(error);
  return new Response('Internal Server Error', { status: 500 });
};

export function nodeAdapter(options: NodeAdapterOptions = {}): PlatformAdapter {
  const onError = options.onError ?? defaultOnError;
  return {
    name: 'node',
    async serve(handler: FetchHandler, serve: ServeOptions = {}): Promise<HttpServer> {
      const { port = 3000, hostname = '0.0.0.0' } = serve;
      const server = options.createServer?.() ?? createServer();
      server.on('request', (req, res) => {
        dispatch(handler, onError, req, res);
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, hostname, () => {
          server.off('error', reject);
          resolve();
        });
      });
      const addr = server.address() as AddressInfo;
      const host = addr.family === 'IPv6' ? `[${addr.address}]` : addr.address;
      return {
        hostname: addr.address,
        port: addr.port,
        url: `http://${host}:${addr.port}`,
        close: ({ force = false } = {}) =>
          new Promise<void>((resolve, reject) => {
            if (force) server.closeAllConnections();
            else server.closeIdleConnections();
            server.close((err) => (err ? reject(err) : resolve()));
          }),
      };
    },
  };
}

function toRequest(req: IncomingMessage, res: ServerResponse): Request {
  const method = req.method ?? 'GET';
  const encrypted = (req.socket as { encrypted?: boolean }).encrypted === true;
  const host = req.headers.host ?? 'localhost';
  const url = `${encrypted ? 'https' : 'http'}://${host}${req.url ?? '/'}`;

  const rawHeaders = req.rawHeaders;
  const headers: [string, string][] = new Array(rawHeaders.length / 2);
  for (let i = 0, j = 0; i < rawHeaders.length; i += 2, j++) {
    headers[j] = [rawHeaders[i]!, rawHeaders[i + 1]!];
  }

  // Aborts `request.signal` when the client disconnects before the response is finished,
  // so handlers can stop streaming or cancel work nobody is waiting for.
  const abort = new AbortController();
  res.once('close', () => {
    if (!res.writableFinished) abort.abort();
  });

  const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: abort.signal };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }
  const request = new Request(url, init);
  raw.set(request, { req, res });
  return request;
}

async function dispatch(
  handler: FetchHandler,
  onError: NonNullable<NodeAdapterOptions['onError']>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let request: Request | undefined;
  let response: Response;
  try {
    request = toRequest(req, res);
    const remoteAddress = req.socket.remoteAddress;
    response = await handler(request, remoteAddress === undefined ? undefined : { remoteAddress });
  } catch (error) {
    try {
      response = await onError(error, request ?? new Request('http://localhost/'));
    } catch {
      response = new Response('Internal Server Error', { status: 500 });
    }
  }
  try {
    await writeResponse(res, response, req.method === 'HEAD');
  } catch (error) {
    // Client went away mid-write or the response body stream failed.
    if (!res.destroyed) res.destroy(error instanceof Error ? error : undefined);
  }
}

/**
 * Node's `Response` keeps the string or bytes it was constructed from in internal state.
 * Writing that directly skips the ReadableStream machinery, which otherwise costs about as
 * much as the rest of the request. Detected by shape at startup; absent on other runtimes
 * or if undici changes, in which case every response streams.
 */
const kState: symbol | undefined = Object.getOwnPropertySymbols(new Response(null)).find(
  (s) => s.description === 'state',
);

interface UndiciState {
  body: { stream: ReadableStream; source: unknown; length: number | null } | null;
}

function sourceOf(response: Response): string | Uint8Array | undefined {
  if (!kState) return undefined;
  const state = (response as unknown as Record<symbol, UndiciState | undefined>)[kState];
  const body = state?.body;
  if (!body || body.stream.locked) return undefined;
  const src = body.source;
  if (typeof src === 'string' || src instanceof Uint8Array) return src;
  return undefined;
}

async function writeResponse(
  res: ServerResponse,
  response: Response,
  isHead: boolean,
): Promise<void> {
  const flat: string[] = [];
  let hasCookies = false;
  for (const [name, value] of response.headers) {
    if (name === 'set-cookie') hasCookies = true;
    else flat.push(name, value);
  }
  if (hasCookies)
    for (const cookie of response.headers.getSetCookie()) flat.push('set-cookie', cookie);

  const body = response.body;
  if (body === null || isHead || response.status === 204 || response.status === 304) {
    res.writeHead(response.status, response.statusText || undefined, flat);
    res.end();
    if (body && !body.locked) await body.cancel().catch(() => {});
    return;
  }

  const source = sourceOf(response);
  if (source !== undefined) {
    if (!response.headers.has('content-length')) {
      const length = typeof source === 'string' ? Buffer.byteLength(source) : source.byteLength;
      flat.push('content-length', String(length));
    }
    res.writeHead(response.status, response.statusText || undefined, flat);
    res.end(source);
    return;
  }

  res.writeHead(response.status, response.statusText || undefined, flat);
  const reader = body.getReader();
  const onClose = () => {
    reader.cancel().catch(() => {});
  };
  res.once('close', onClose);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } finally {
    res.off('close', onClose);
  }
}
