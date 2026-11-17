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

export interface EncryptOptions {
  /**
   * Data the ciphertext is bound to, such as a row id or user id. It is not stored in the
   * ciphertext: decrypt with the same value, or decryption fails. Stops a ciphertext from
   * being copied into another row.
   */
  context?: Data;
}

export interface Encrypter {
  /** Encrypts text or bytes into a URL-safe string, for database columns and JSON. */
  encrypt(plaintext: Data, options?: EncryptOptions): Promise<string>;
  /** Decrypts a string from `encrypt` back to text. Throws `CryptoError` if it fails. */
  decrypt(ciphertext: string, options?: EncryptOptions): Promise<string>;
  /** Encrypts into raw bytes, for files and binary columns. About 29 bytes larger than the input. */
  encryptBytes(plaintext: Data, options?: EncryptOptions): Promise<Bytes>;
  /** Decrypts bytes from `encryptBytes`. Throws `CryptoError` if it fails. */
  decryptBytes(ciphertext: Uint8Array, options?: EncryptOptions): Promise<Bytes>;
}

export interface EncrypterOptions {
  /** Gives each use its own key, so data encrypted as `ssn` cannot be decrypted as `notes`. */
  purpose?: string;
  /** Older secrets still accepted when decrypting, for rotation. Never used to encrypt. */
  previousSecrets?: (string | Uint8Array)[];
}

export interface PublicKeyEncrypterOptions {
  /** RSA-OAEP SHA-256 public key, needed to encrypt. A PEM (SPKI), JWK or `CryptoKey`. */
  publicKey?: KeyInput;
  /** RSA-OAEP SHA-256 private key, needed to decrypt. A PEM (PKCS#8), JWK or `CryptoKey`. */
  privateKey?: KeyInput;
  /** Older private keys still tried when decrypting, for rotation. */
  previousPrivateKeys?: KeyInput[];
}

/** First byte of every ciphertext: the format, so it can change without breaking old data. */
const SYMMETRIC = 1;
const PUBLIC_KEY = 2;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const OAEP = { name: 'RSA-OAEP', hash: 'SHA-256' };
const GCM = 'AES-GCM';

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

/** AES-256-GCM over `plaintext`, authenticating `header` and the context. Returns iv + ciphertext. */
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

/** Adds the string forms to a pair of byte functions. */
function withText(
  encryptBytes: Encrypter['encryptBytes'],
  decryptBytes: Encrypter['decryptBytes'],
): Encrypter {
  return {
    encryptBytes,
    decryptBytes,
    encrypt: async (plaintext, options) => base64urlEncode(await encryptBytes(plaintext, options)),
    async decrypt(ciphertext, options) {
      let bytes: Bytes;
      try {
        bytes = base64urlDecode(ciphertext);
      } catch {
        throw failed();
      }
      return utf8(await decryptBytes(bytes, options));
    },
  };
}

/**
 * Authenticated encryption (AES-256-GCM) with a secret you keep, for data you store: database
 * fields, files, backups. Each `purpose` gets its own key, derived from the secret with HKDF.
 *
 * ```ts
 * const ssn = createEncrypter(env.DATA_KEY, { purpose: 'user.ssn' });
 * const stored = await ssn.encrypt('123-45-6789', { context: user.id });
 * const plain = await ssn.decrypt(stored, { context: user.id });
 * ```
 */
export function createEncrypter(
  secret: string | Uint8Array,
  options: EncrypterOptions = {},
): Encrypter {
  const info = toBytes(`suku.encrypt:${options.purpose ?? ''}`);
  const load = async (s: string | Uint8Array) => {
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
    (keys ??= Promise.all([secret, ...(options.previousSecrets ?? [])].map(load)));
  const header = Uint8Array.of(SYMMETRIC) as Bytes;

  return withText(
    async (plaintext, o = {}) => seal((await getKeys())[0]!, header, plaintext, o.context),
    async (ciphertext, o = {}) => {
      if (
        !(ciphertext instanceof Uint8Array) ||
        ciphertext[0] !== SYMMETRIC ||
        ciphertext.length < 1 + IV_BYTES + TAG_BYTES
      )
        throw failed();
      for (const key of await getKeys()) {
        try {
          return await open(key, header, ciphertext.subarray(1), o.context);
        } catch {
          // Another key may have encrypted it.
        }
      }
      throw failed();
    },
  );
}

/**
 * Public-key encryption: anyone with the public key can encrypt, and only the private key can
 * decrypt. Each message gets a random AES-256-GCM key, which is encrypted with RSA-OAEP
 * (SHA-256), so messages of any size work. Use it when the service that encrypts must not be
 * able to read the data back, such as a form that collects documents for a back office.
 *
 * ```ts
 * const inbox = createPublicKeyEncrypter({ publicKey: env.INBOX_PUBLIC_KEY });
 * const sealed = await inbox.encrypt(document);
 * ```
 */
export function createPublicKeyEncrypter(options: PublicKeyEncrypterOptions): Encrypter {
  let publicKey: Promise<CryptoKey> | undefined;
  let privateKeys: Promise<CryptoKey[]> | undefined;
  const getPublicKey = () => {
    if (!options.publicKey) throw new CryptoError('invalid_key', 'Encrypting needs a publicKey.');
    return (publicKey ??= importKey(options.publicKey, OAEP, 'encrypt', 'RSA-OAEP'));
  };
  const getPrivateKeys = () => {
    if (!options.privateKey) throw new CryptoError('invalid_key', 'Decrypting needs a privateKey.');
    return (privateKeys ??= Promise.all(
      [options.privateKey, ...(options.previousPrivateKeys ?? [])].map((k) =>
        importKey(k, OAEP, 'decrypt', 'RSA-OAEP'),
      ),
    ));
  };

  return withText(
    async (plaintext, o = {}) => {
      const raw = randomBytes(32);
      const wrapped = new Uint8Array(await crypto.subtle.encrypt(OAEP, await getPublicKey(), raw));
      const key = await crypto.subtle.importKey('raw', raw, GCM, false, ['encrypt']);
      // Format byte, then the wrapped key's length and the wrapped key, all authenticated.
      const header = concat(
        Uint8Array.of(PUBLIC_KEY, wrapped.length >> 8, wrapped.length),
        wrapped,
      );
      return seal(key, header, plaintext, o.context);
    },
    async (ciphertext, o = {}) => {
      if (!(ciphertext instanceof Uint8Array) || ciphertext[0] !== PUBLIC_KEY) throw failed();
      const end = 3 + ((ciphertext[1]! << 8) | ciphertext[2]!);
      if (ciphertext.length < end + IV_BYTES + TAG_BYTES) throw failed();
      const header = ciphertext.subarray(0, end);
      const wrapped = toBytes(header.subarray(3));
      for (const privateKey of await getPrivateKeys()) {
        try {
          const raw = await crypto.subtle.decrypt(OAEP, privateKey, wrapped);
          const key = await crypto.subtle.importKey('raw', raw, GCM, false, ['decrypt']);
          return await open(key, header, ciphertext.subarray(end), o.context);
        } catch {
          // Another private key may match.
        }
      }
      throw failed();
    },
  );
}
