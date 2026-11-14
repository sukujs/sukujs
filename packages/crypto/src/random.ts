import { type Bytes, base64urlEncode, hexEncode } from './encoding.js';
import { CryptoError } from './errors.js';

/** Cryptographically secure random bytes. */
export function randomBytes(length: number): Bytes {
  if (!Number.isInteger(length) || length < 0 || length > 65536) {
    throw new CryptoError('invalid_input', 'Length must be an integer between 0 and 65536.');
  }
  return crypto.getRandomValues(new Uint8Array(length)) as Bytes;
}

/** A URL-safe random token. 32 bytes (256 bits) by default: session ids, reset tokens, API keys. */
export function randomToken(bytes = 32): string {
  return base64urlEncode(randomBytes(bytes));
}

export function randomHex(bytes = 16): string {
  return hexEncode(randomBytes(bytes));
}

export function randomUUID(): string {
  return crypto.randomUUID();
}

/** A uniformly distributed integer in `[min, max)`, without modulo bias. */
export function randomInt(min: number, max: number): number {
  const range = max - min;
  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    range <= 0 ||
    range > 0xffffffff
  ) {
    throw new CryptoError(
      'invalid_input',
      'randomInt needs integers with 0 < max - min <= 2^32 - 1.',
    );
  }
  const limit = Math.floor(0x100000000 / range) * range;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0]! < limit) return min + (buffer[0]! % range);
  }
}
