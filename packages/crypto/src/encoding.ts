import { CryptoError } from './errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export type Bytes = Uint8Array<ArrayBuffer>;
export type Data = string | Uint8Array;

export function toBytes(data: Data): Bytes {
  if (typeof data === 'string') return encoder.encode(data) as Bytes;
  return new Uint8Array(data) as Bytes;
}

export function utf8(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch (cause) {
    throw new CryptoError('malformed', 'Bytes are not valid UTF-8.', { cause });
  }
}

export function base64urlEncode(data: Data): string {
  const bytes = toBytes(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const BASE64URL = /^[A-Za-z0-9_-]*$/;

export function base64urlDecode(text: string): Bytes {
  if (!BASE64URL.test(text) || text.length % 4 === 1) {
    throw new CryptoError('malformed', 'Value is not valid base64url.');
  }
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out as Bytes;
}

export function hexEncode(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Compares two values without leaking where they differ through timing. Use it for
 * secrets you compare yourself (API keys, tokens); signatures made by this package are
 * already verified in constant time.
 */
export function timingSafeEqual(a: Data, b: Data): boolean {
  const x = toBytes(a);
  const y = toBytes(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
