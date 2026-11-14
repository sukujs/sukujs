const encoder = new TextEncoder();

/**
 * Turns a handler's return value into a `Response`:
 *
 * - `Response` is sent as-is.
 * - `undefined` / `null` -> empty body, 204 unless the route set a status.
 * - `string` -> `text/plain`.
 * - `Uint8Array` / `ArrayBuffer` -> `application/octet-stream`.
 * - `ReadableStream`, `Blob`, `FormData`, `URLSearchParams` -> passed to `Response` directly.
 * - anything else -> JSON.
 */
export function toResponse(value: unknown, method: string, explicitStatus?: number): Response {
  if (value instanceof Response) return value;
  const status = explicitStatus ?? (method === 'POST' ? 201 : 200);
  if (value === undefined || value === null)
    return new Response(null, { status: explicitStatus ?? 204 });
  if (typeof value === 'string') {
    return new Response(value, {
      status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return new Response(value as ArrayBuffer, {
      status,
      headers: { 'content-type': 'application/octet-stream' },
    });
  }
  if (
    value instanceof ReadableStream ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams
  ) {
    return new Response(value, { status });
  }
  return new Response(encoder.encode(JSON.stringify(value)), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
