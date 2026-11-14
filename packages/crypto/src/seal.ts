import { type Duration, toSeconds } from './duration.js';
import { base64urlDecode, base64urlEncode, toBytes, utf8 } from './encoding.js';
import { CryptoError } from './errors.js';
import { randomBytes } from './random.js';

export interface SealerOptions {
  /** Binds sealed values to a use, so a value sealed as `session` cannot be opened as `reset`. */
  purpose?: string;
  /** Older secrets still accepted when unsealing, for rotation. */
  previousSecrets?: (string | Uint8Array)[];
  /** Clock in milliseconds. For tests. */
  now?: () => number;
}

export interface Sealer {
  /** Encrypts any JSON value into a URL-safe string. `ttl` makes it expire. */
  seal(value: unknown, options?: { ttl?: Duration }): Promise<string>;
  /** The original value, or `undefined` if it was tampered with, expired, or sealed with another key. */
  unseal<T = unknown>(sealed: string): Promise<T | undefined>;
}

const VERSION = 'v1';

/**
 * Authenticated encryption (AES-256-GCM) for values the client holds but must not read or
 * change: encrypted cookies, OAuth state, password-reset payloads.
 */
export function createSealer(secret: string | Uint8Array, options: SealerOptions = {}): Sealer {
  const purpose = toBytes(options.purpose ?? 'suku.seal');
  const now = () => options.now?.() ?? Date.now();

  const load = async (s: string | Uint8Array): Promise<CryptoKey> => {
    const bytes = toBytes(s);
    if (bytes.byteLength < 32) {
      throw new CryptoError(
        'weak_key',
        `Sealing secret must be at least 32 bytes; got ${bytes.byteLength}.`,
      );
    }
    const material = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: toBytes('suku.seal.v1'), info: purpose },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  };
  let keys: Promise<CryptoKey[]> | undefined;
  const getKeys = () =>
    (keys ??= Promise.all([secret, ...(options.previousSecrets ?? [])].map(load)));

  return {
    async seal(value, sealOptions = {}) {
      const envelope: { d: unknown; e?: number } = { d: value };
      if (sealOptions.ttl !== undefined) envelope.e = now() + toSeconds(sealOptions.ttl) * 1000;
      const json = JSON.stringify(envelope);
      if (json === undefined)
        throw new CryptoError('invalid_input', 'Value cannot be serialised to JSON.');
      const iv = randomBytes(12);
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: purpose },
        (await getKeys())[0]!,
        toBytes(json),
      );
      return `${VERSION}.${base64urlEncode(iv)}.${base64urlEncode(new Uint8Array(ciphertext))}`;
    },

    async unseal<T>(sealed: string) {
      if (typeof sealed !== 'string') return undefined;
      const parts = sealed.split('.');
      if (parts.length !== 3 || parts[0] !== VERSION) return undefined;
      let iv: Uint8Array<ArrayBuffer>;
      let ciphertext: Uint8Array<ArrayBuffer>;
      try {
        iv = base64urlDecode(parts[1]!);
        ciphertext = base64urlDecode(parts[2]!);
      } catch {
        return undefined;
      }
      if (iv.byteLength !== 12) return undefined;
      for (const key of await getKeys()) {
        try {
          const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData: purpose },
            key,
            ciphertext,
          );
          const envelope = JSON.parse(utf8(new Uint8Array(plain))) as { d: T; e?: number };
          if (envelope.e !== undefined && now() >= envelope.e) return undefined;
          return envelope.d;
        } catch {
          // Wrong key or tampered data: try the next key.
        }
      }
      return undefined;
    },
  };
}
