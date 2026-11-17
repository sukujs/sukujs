import type { Bytes } from './encoding.js';
import { CryptoError } from './errors.js';

/** A PEM string (PKCS#8 private or SPKI public), a JWK, or an imported `CryptoKey`. */
export type KeyInput = string | JsonWebKey | CryptoKey;

/** Import parameters, such as `{ name: 'ECDSA', namedCurve: 'P-256' }`. */
export interface KeyParams {
  name: string;
  namedCurve?: string;
  hash?: string | { name: string };
}

type ErrorClass = new (
  code: 'invalid_key' | 'weak_key',
  message: string,
  options?: object,
) => Error;

/** RFC 7518 section 3.3 and NIST SP 800-131A: RSA keys must be at least 2048 bits. */
const MIN_RSA_BITS = 2048;

function pemBody(pem: string, label: string): Bytes | undefined {
  const match = new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`).exec(pem);
  if (!match) return undefined;
  const binary = atob(match[1]!.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out as Bytes;
}

/** `ECDSA P-256`, `RSA-PSS SHA-256` or `Ed25519`: what a key is for, from import params or a key. */
function keyType({ name, namedCurve, hash }: KeyParams): string {
  return [name, namedCurve, typeof hash === 'object' ? hash.name : hash].filter(Boolean).join(' ');
}

/**
 * Imports an asymmetric key from PEM, JWK or a `CryptoKey`, and checks that it fits `params`.
 * Web Crypto checks a PEM or JWK on import, but a `CryptoKey` is used as given, so the check
 * also runs here. `label` names the algorithm in errors, which are thrown as `Err`.
 */
export async function importKey(
  input: KeyInput,
  params: KeyParams,
  usage: 'sign' | 'verify' | 'encrypt' | 'decrypt',
  label: string,
  Err: ErrorClass = CryptoError,
): Promise<CryptoKey> {
  const isPrivate = usage === 'sign' || usage === 'decrypt';
  let key: CryptoKey;
  try {
    if (typeof input === 'string') {
      const block = isPrivate ? 'PRIVATE KEY' : 'PUBLIC KEY';
      const der = pemBody(input, block);
      if (!der) {
        throw new Err(
          'invalid_key',
          `Expected a PEM "${block}" block (${isPrivate ? 'PKCS#8' : 'SPKI'}). ` +
            'Convert legacy "RSA PRIVATE KEY" / "EC PRIVATE KEY" files with: openssl pkcs8 -topk8 -nocrypt.',
        );
      }
      key = await crypto.subtle.importKey(isPrivate ? 'pkcs8' : 'spki', der, params, false, [
        usage,
      ]);
    } else if (typeof CryptoKey !== 'undefined' && input instanceof CryptoKey) {
      if (!input.usages.includes(usage))
        throw new Err('invalid_key', `CryptoKey does not allow "${usage}".`);
      key = input;
    } else {
      key = await crypto.subtle.importKey('jwk', input as JsonWebKey, params, false, [usage]);
    }
  } catch (cause) {
    if (cause instanceof Err) throw cause;
    throw new Err('invalid_key', `Could not import the ${usage} key for ${label}.`, { cause });
  }
  const want = keyType(params);
  const got = keyType(key.algorithm as KeyParams);
  if (got !== want) throw new Err('invalid_key', `${label} needs a ${want} key; got ${got}.`);
  const bits = (key.algorithm as RsaKeyAlgorithm).modulusLength;
  if (bits < MIN_RSA_BITS) {
    throw new Err('weak_key', `${label} needs an RSA key of ${MIN_RSA_BITS}+ bits; got ${bits}.`);
  }
  return key;
}
