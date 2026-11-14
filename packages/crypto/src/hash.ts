import { type Bytes, type Data, hexEncode, toBytes } from './encoding.js';

export type HashAlgorithm = 'SHA-256' | 'SHA-384' | 'SHA-512';

/** Raw digest bytes. Not for passwords: use `hashPassword`. */
export async function digest(algorithm: HashAlgorithm, data: Data): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest(algorithm, toBytes(data))) as Bytes;
}

/** Hex SHA-256, e.g. for content fingerprints and cache keys. */
export async function sha256(data: Data): Promise<string> {
  return hexEncode(await digest('SHA-256', data));
}

export async function sha512(data: Data): Promise<string> {
  return hexEncode(await digest('SHA-512', data));
}
