import { base64urlDecode, base64urlEncode, type Data, toBytes } from './encoding.js';
import { CryptoError } from './errors.js';
import type { HashAlgorithm } from './hash.js';

export interface SignerOptions {
  hash?: HashAlgorithm;
  /** Older secrets still accepted when verifying, for rotation. */
  previousSecrets?: (string | Uint8Array)[];
}

export interface Signer {
  /** HMAC of the data, base64url. */
  sign(data: Data): Promise<string>;
  /** Constant-time check. `false` for anything malformed. */
  verify(data: Data, signature: string): Promise<boolean>;
  /** `value.signature`, for cookies and links whose content may be read but not changed. */
  pack(value: string): Promise<string>;
  /** The original value, or `undefined` if the signature does not match. */
  unpack(packed: string): Promise<string | undefined>;
}

/**
 * HMAC signing for values that must not be tampered with: cookies, webhook payloads,
 * unsubscribe links. The value stays readable; use `createSealer` to hide it.
 */
export function createSigner(secret: string | Uint8Array, options: SignerOptions = {}): Signer {
  const hash = options.hash ?? 'SHA-256';
  const load = (s: string | Uint8Array) => {
    const bytes = toBytes(s);
    if (bytes.byteLength < 32) {
      throw new CryptoError(
        'weak_key',
        `Signing secret must be at least 32 bytes; got ${bytes.byteLength}.`,
      );
    }
    return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash }, false, ['sign', 'verify']);
  };
  let keys: Promise<CryptoKey[]> | undefined;
  const getKeys = () =>
    (keys ??= Promise.all([secret, ...(options.previousSecrets ?? [])].map(load)));

  const sign = async (data: Data) =>
    base64urlEncode(
      new Uint8Array(await crypto.subtle.sign('HMAC', (await getKeys())[0]!, toBytes(data))),
    );

  const verify = async (data: Data, signature: string) => {
    let sig: Uint8Array<ArrayBuffer>;
    try {
      sig = base64urlDecode(signature);
    } catch {
      return false;
    }
    for (const key of await getKeys()) {
      if (await crypto.subtle.verify('HMAC', key, sig, toBytes(data))) return true;
    }
    return false;
  };

  return {
    sign,
    verify,
    pack: async (value) => `${value}.${await sign(value)}`,
    unpack: async (packed) => {
      const at = typeof packed === 'string' ? packed.lastIndexOf('.') : -1;
      if (at === -1) return undefined;
      const value = packed.slice(0, at);
      return (await verify(value, packed.slice(at + 1))) ? value : undefined;
    },
  };
}
