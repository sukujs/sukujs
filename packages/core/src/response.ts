import type { HandlerMetadata } from './controller.js';

export interface RedirectResult {
  url: string;
  status?: number;
}

const encoder = new TextEncoder();

/**
 * Turns a handler's return value into a `Response`:
 *
 * - `Response` is sent as-is (decorator headers are still applied).
 * - `undefined` / `null` -> empty body; status 204 unless `@HttpCode` set one.
 * - `string` -> `text/plain`.
 * - `Uint8Array` / `ArrayBuffer` -> `application/octet-stream`.
 * - `ReadableStream`, `Blob`, `FormData`, `URLSearchParams` -> passed to `Response` directly.
 * - anything else -> JSON.
 */
export function toResponse(
  value: unknown,
  method: string,
  meta: HandlerMetadata | undefined,
): Response {
  if (meta?.redirect) {
    const override =
      value !== null && typeof value === 'object' && 'url' in value
        ? (value as RedirectResult)
        : undefined;
    const res = new Response(null, {
      status: override?.status ?? meta.redirect.status,
      headers: { location: override?.url ?? meta.redirect.url },
    });
    return applyHeaders(res, meta);
  }

  if (value instanceof Response) return applyHeaders(value, meta);

  const status = meta?.httpCode ?? (method === 'POST' ? 201 : 200);

  if (value === undefined || value === null) {
    return applyHeaders(new Response(null, { status: meta?.httpCode ?? 204 }), meta);
  }
  if (typeof value === 'string') {
    return applyHeaders(
      new Response(value, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } }),
      meta,
    );
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return applyHeaders(
      new Response(value as ArrayBuffer, {
        status,
        headers: { 'content-type': 'application/octet-stream' },
      }),
      meta,
    );
  }
  if (
    value instanceof ReadableStream ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams
  ) {
    return applyHeaders(new Response(value, { status }), meta);
  }
  return applyHeaders(
    new Response(encoder.encode(JSON.stringify(value)), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }),
    meta,
  );
}

function applyHeaders(res: Response, meta: HandlerMetadata | undefined): Response {
  if (!meta || meta.headers.length === 0) return res;
  for (const [name, value] of meta.headers) res.headers.set(name, value);
  return res;
}
