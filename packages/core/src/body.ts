import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from './http-errors.js';
import { createParamDecorator } from './params.js';

export interface BodyOptions {
  /** Reject bodies larger than this many bytes with 413. Default 1 MiB. */
  limit?: number;
}

const DEFAULT_LIMIT = 1024 * 1024;

function mediaType(request: Request): string {
  const ct = request.headers.get('content-type') ?? '';
  const semi = ct.indexOf(';');
  return (semi === -1 ? ct : ct.slice(0, semi)).trim().toLowerCase();
}

async function readWithLimit(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) throw new PayloadTooLargeException();
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      reader.cancel().catch(() => {});
      throw new PayloadTooLargeException();
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const decoder = new TextDecoder();

/**
 * Parses the request body by content type:
 * JSON -> value, form-urlencoded -> object, multipart -> `FormData`, text -> string,
 * anything else -> `Uint8Array`. An empty body yields `undefined`.
 */
export async function parseBody(request: Request, options: BodyOptions = {}): Promise<unknown> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const type = mediaType(request);
  if (type === 'multipart/form-data') {
    const declared = request.headers.get('content-length');
    if (declared !== null && Number(declared) > limit) throw new PayloadTooLargeException();
    try {
      return await request.formData();
    } catch (cause) {
      throw new BadRequestException('Malformed multipart body', { cause });
    }
  }
  const bytes = await readWithLimit(request, limit);
  if (bytes.byteLength === 0) return undefined;
  if (type === 'application/json' || type.endsWith('+json')) {
    try {
      return JSON.parse(decoder.decode(bytes));
    } catch (cause) {
      throw new BadRequestException('Malformed JSON body', { cause });
    }
  }
  if (type === 'application/x-www-form-urlencoded') {
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of new URLSearchParams(decoder.decode(bytes))) {
      const existing = out[k];
      if (existing === undefined) out[k] = v;
      else if (Array.isArray(existing)) existing.push(v);
      else out[k] = [existing, v];
    }
    return out;
  }
  if (type.startsWith('text/') || type === '') return decoder.decode(bytes);
  return bytes;
}

/** Throws 415 unless the request's media type is one of `types`. */
export function assertMediaType(request: Request, types: string[]): void {
  const type = mediaType(request);
  if (!types.includes(type))
    throw new UnsupportedMediaTypeException(`Expected ${types.join(' or ')}`);
}

/**
 * The parsed request body (`@Body()`), or one property of it (`@Body('name')`). Pass a
 * Standard Schema to validate: `@Body(CreateUser)`. Parsed once per request via `ctx.body()`.
 */
export const Body = createParamDecorator<string>('Body', async (name, ctx) => {
  const value = await ctx.body();
  if (name === undefined) return value;
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)[name]
    : undefined;
});
