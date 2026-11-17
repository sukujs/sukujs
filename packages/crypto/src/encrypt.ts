import {
  type Bytes,
  base64urlDecode,
  base64urlEncode,
  type Data,
  toBytes,
  utf8,
} from './encoding.js';
import { CryptoError } from './errors.js';
import { importKey, type KeyInput } from './keys.js';
import { randomBytes } from './random.js';

/**
 * - `AES-256-GCM`: one secret encrypts and decrypts.
 * - `RSA-OAEP-256`: a public key encrypts, the private key decrypts. Each message gets a
 *   random AES-256-GCM key, which is encrypted with RSA-OAEP using SHA-256.
 */
export type EncryptionAlgorithm = 'AES-256-GCM' | 'RSA-OAEP-256';

export interface EncryptOptions {
  /**
   * Data the ciphertext is bound to, such as a row id or user id. It is not stored in the
   * ciphertext: decrypt with the same value, or decryption fails. Stops a ciphertext from
   * being copied into another row.
   */
  context?: Data;
}

export interface Encrypter {
  readonly algorithm: EncryptionAlgorithm;
  /**
   * Encrypts text or bytes. Returns a URL-safe string, for database columns and JSON, or raw
   * bytes with `{ as: 'bytes' }`, for files.
   */
  encrypt(plaintext: Data, options?: EncryptOptions & { as?: 'text' }): Promise<string>;
  encrypt(plaintext: Data, options: EncryptOptions & { as: 'bytes' }): Promise<Bytes>;
  /**
   * Decrypts what `encrypt` returned, string or bytes. Returns text, or raw bytes with
   * `{ as: 'bytes' }`. Throws `CryptoError` with code `decryption_failed` if the data was
   * changed, or encrypted with another key, purpose or context.
   */
  decrypt(
    ciphertext: string | Uint8Array,
    options?: EncryptOptions & { as?: 'text' },
  ): Promise<string>;
  decrypt(
    ciphertext: string | Uint8Array,
    options: EncryptOptions & { as: 'bytes' },
  ): Promise<Bytes>;
}

export interface SecretEncrypterOptions {
  algorithm?: 'AES-256-GCM';
  /** At least 32 bytes. Generate one with `randomToken(32)`. */
  secret: string | Uint8Array;
  /** Gives each use its own key, so data encrypted as `ssn` cannot be decrypted as `notes`. */
  purpose?: string;
  /** Older secrets still accepted when decrypting, for rotation. Never used to encrypt. */
  previousSecrets?: (string | Uint8Array)[];
}

export interface KeyPairEncrypterOptions {
  algorithm: 'RSA-OAEP-256';
  /** Needed to encrypt. A PEM (SPKI), JWK or `CryptoKey`; RSA-OAEP with SHA-256, 2048+ bits. */
  publicKey?: KeyInput;
  /** Needed to decrypt. A PEM (PKCS#8), JWK or `CryptoKey`. Omit it where data is only written. */
  privateKey?: KeyInput;
  /** Older private keys still tried when decrypting, for rotation. */
  previousPrivateKeys?: KeyInput[];
}

export type EncrypterOptions = SecretEncrypterOptions | KeyPairEncrypterOptions;

/** First byte of every ciphertext: the format, so it can change without breaking old data. */
const SYMMETRIC = 1;
const PUBLIC_KEY = 2;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const OAEP = { name: 'RSA-OAEP', hash: 'SHA-256' };
const GCM = 'AES-GCM';

type Encrypt = (plaintext: Data, context?: Data) => Promise<Bytes>;
type Decrypt = (ciphertext: Bytes, context?: Data) => Promise<Bytes>;

const failed = () =>
  new CryptoError(
    'decryption_failed',
    'Could not decrypt: the data was changed, or encrypted with another key, purpose or context.',
  );

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out as Bytes;
}

/** AES-256-GCM over `plaintext`, authenticating `header` and the context. Returns header, IV, ciphertext. */
async function seal(key: CryptoKey, header: Bytes, plaintext: Data, context?: Data) {
  const iv = randomBytes(IV_BYTES);
  const additionalData = concat(header, toBytes(context ?? ''));
  const body = await crypto.subtle.encrypt(
    { name: GCM, iv, additionalData },
    key,
    toBytes(plaintext),
  );
  return concat(header, iv, new Uint8Array(body));
}

async function open(key: CryptoKey, header: Uint8Array, rest: Uint8Array, context?: Data) {
  const additionalData = concat(header, toBytes(context ?? ''));
  const iv = toBytes(rest.subarray(0, IV_BYTES));
  const body = toBytes(rest.subarray(IV_BYTES));
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: GCM, iv, additionalData }, key, body),
  ) as Bytes;
}

function withSecret(options: SecretEncrypterOptions): [Encrypt, Decrypt] {
  const info = toBytes(`suku.encrypt:${options.purpose ?? ''}`);
  const load = async (s: string | Uint8Array) => {
    if (s === undefined) throw new CryptoError('invalid_key', 'AES-256-GCM needs a secret.');
    const bytes = toBytes(s);
    if (bytes.byteLength < 32) {
      throw new CryptoError(
        'weak_key',
        `Encryption secret must be at least 32 bytes; got ${bytes.byteLength}.`,
      );
    }
    const material = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: toBytes('suku.encrypt.v1'), info },
      material,
      { name: GCM, length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  };
  let keys: Promise<CryptoKey[]> | undefined;
  const getKeys = () =>
    (keys ??= Promise.all([options.secret, ...(options.previousSecrets ?? [])].map(load)));
  const header = Uint8Array.of(SYMMETRIC) as Bytes;

  return [
    async (plaintext, context) => seal((await getKeys())[0]!, header, plaintext, context),
    async (ciphertext, context) => {
      if (ciphertext[0] !== SYMMETRIC || ciphertext.length < 1 + IV_BYTES + TAG_BYTES)
        throw failed();
      for (const key of await getKeys()) {
        try {
          return await open(key, header, ciphertext.subarray(1), context);
        } catch {
          // Another key may have encrypted it.
        }
      }
      throw failed();
    },
  ];
}

function withKeyPair(options: KeyPairEncrypterOptions): [Encrypt, Decrypt] {
  let publicKey: Promise<CryptoKey> | undefined;
  let privateKeys: Promise<CryptoKey[]> | undefined;
  const getPublicKey = () => {
    if (!options.publicKey) throw new CryptoError('invalid_key', 'Encrypting needs a publicKey.');
    return (publicKey ??= importKey(options.publicKey, OAEP, 'encrypt', 'RSA-OAEP-256'));
  };
  const getPrivateKeys = () => {
    if (!options.privateKey) throw new CryptoError('invalid_key', 'Decrypting needs a privateKey.');
    return (privateKeys ??= Promise.all(
      [options.privateKey, ...(options.previousPrivateKeys ?? [])].map((k) =>
        importKey(k, OAEP, 'decrypt', 'RSA-OAEP-256'),
      ),
    ));
  };

  return [
    async (plaintext, context) => {
      const raw = randomBytes(32);
      const wrapped = new Uint8Array(await crypto.subtle.encrypt(OAEP, await getPublicKey(), raw));
      const key = await crypto.subtle.importKey('raw', raw, GCM, false, ['encrypt']);
      // Format byte, then the wrapped key's length and the wrapped key, all authenticated.
      const header = concat(
        Uint8Array.of(PUBLIC_KEY, wrapped.length >> 8, wrapped.length),
        wrapped,
      );
      return seal(key, header, plaintext, context);
    },
    async (ciphertext, context) => {
      if (ciphertext[0] !== PUBLIC_KEY) throw failed();
      const end = 3 + ((ciphertext[1]! << 8) | ciphertext[2]!);
      if (ciphertext.length < end + IV_BYTES + TAG_BYTES) throw failed();
      const header = ciphertext.subarray(0, end);
      const wrapped = toBytes(header.subarray(3));
      for (const privateKey of await getPrivateKeys()) {
        try {
          const raw = await crypto.subtle.decrypt(OAEP, privateKey, wrapped);
          const key = await crypto.subtle.importKey('raw', raw, GCM, false, ['decrypt']);
          return await open(key, header, ciphertext.subarray(end), context);
        } catch {
          // Another private key may match.
        }
      }
      throw failed();
    },
  ];
}

/**
 * Encryption for data you store: database fields, files, backups. For a value a client holds,
 * such as a cookie, use `createSealer`.
 *
 * ```ts
 * // One secret encrypts and decrypts (AES-256-GCM, the default).
 * const ssn = createEncrypter({ secret: env.DATA_KEY, purpose: 'user.ssn' });
 * const stored = await ssn.encrypt('123-45-6789', { context: user.id });
 * await ssn.decrypt(stored, { context: user.id });
 *
 * // A public key encrypts, only the private key decrypts.
 * const inbox = createEncrypter({ algorithm: 'RSA-OAEP-256', publicKey: env.INBOX_PUBLIC_KEY });
 * ```
 */
export function createEncrypter(options: EncrypterOptions): Encrypter {
  const algorithm = options.algorithm ?? 'AES-256-GCM';
  let encrypt: Encrypt;
  let decrypt: Decrypt;
  if (algorithm === 'AES-256-GCM') {
    [encrypt, decrypt] = withSecret(options as SecretEncrypterOptions);
  } else if (algorithm === 'RSA-OAEP-256') {
    [encrypt, decrypt] = withKeyPair(options as KeyPairEncrypterOptions);
  } else {
    throw new CryptoError(
      'invalid_input',
      `Unsupported algorithm "${String(algorithm)}". Use AES-256-GCM or RSA-OAEP-256.`,
    );
  }

  return {
    algorithm,
    async encrypt(plaintext: Data, o: EncryptOptions & { as?: string } = {}) {
      const bytes = await encrypt(plaintext, o.context);
      return o.as === 'bytes' ? bytes : base64urlEncode(bytes);
    },
    async decrypt(ciphertext: string | Uint8Array, o: EncryptOptions & { as?: string } = {}) {
      let bytes: Bytes;
      if (ciphertext instanceof Uint8Array) {
        bytes = toBytes(ciphertext);
      } else {
        try {
          bytes = base64urlDecode(ciphertext);
        } catch {
          throw failed();
        }
      }
      const plain = await decrypt(bytes, o.context);
      return o.as === 'bytes' ? plain : utf8(plain);
    },
  } as Encrypter;
}
