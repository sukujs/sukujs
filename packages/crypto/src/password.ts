import { base64urlDecode, base64urlEncode, toBytes } from './encoding.js';
import { CryptoError } from './errors.js';
import { randomBytes } from './random.js';

/** OWASP's 2023 minimum for PBKDF2-HMAC-SHA256. */
export const DEFAULT_PASSWORD_ITERATIONS = 600_000;
const MAX_ITERATIONS = 10_000_000;
const PREFIX = '$pbkdf2-sha256$';

export interface PasswordOptions {
  /** Work factor. Default 600,000. Raise it over time; `needsRehash` tells you which hashes lag. */
  iterations?: number;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    toBytes(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toBytes(salt), iterations },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Hashes a password for storage, with a random salt, as
 * `$pbkdf2-sha256$i=<iterations>$<salt>$<hash>`.
 *
 * PBKDF2 is used because it is the password KDF every Web Crypto runtime provides. If you
 * can take a native dependency, Argon2id is the stronger choice.
 */
export async function hashPassword(
  password: string,
  options: PasswordOptions = {},
): Promise<string> {
  const iterations = options.iterations ?? DEFAULT_PASSWORD_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new CryptoError('invalid_input', 'Invalid iteration count.');
  }
  if (typeof password !== 'string' || password.length === 0)
    throw new CryptoError('invalid_input', 'Password is empty.');
  const salt = randomBytes(16);
  const hash = await derive(password, salt, iterations, 32);
  return `${PREFIX}i=${iterations}$${base64urlEncode(salt)}$${base64urlEncode(hash)}`;
}

function parse(
  stored: string,
): { iterations: number; salt: Uint8Array; hash: Uint8Array } | undefined {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return undefined;
  const [params, salt, hash, ...rest] = stored.slice(PREFIX.length).split('$');
  const match = /^i=(\d{1,8})$/.exec(params ?? '');
  if (!match || !salt || !hash || rest.length) return undefined;
  const iterations = Number(match[1]);
  if (iterations < 1 || iterations > MAX_ITERATIONS) return undefined;
  try {
    return { iterations, salt: base64urlDecode(salt), hash: base64urlDecode(hash) };
  } catch {
    return undefined;
  }
}

/** `true` only if the password matches. Malformed stored values are `false`, never an error. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed || typeof password !== 'string') return false;
  const actual = await derive(password, parsed.salt, parsed.iterations, parsed.hash.length);
  let diff = actual.length ^ parsed.hash.length;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ (parsed.hash[i] ?? 0);
  return diff === 0;
}

/** Whether a stored hash uses fewer iterations than you now want. Rehash after a successful login. */
export function needsRehash(stored: string, options: PasswordOptions = {}): boolean {
  const parsed = parse(stored);
  return !parsed || parsed.iterations < (options.iterations ?? DEFAULT_PASSWORD_ITERATIONS);
}
