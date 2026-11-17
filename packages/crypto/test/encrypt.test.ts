import { describe, expect, test } from 'bun:test';
import { constants, createDecipheriv, hkdfSync, privateDecrypt } from 'node:crypto';
import {
  base64urlDecode,
  base64urlEncode,
  createEncrypter,
  CryptoError,
  randomBytes,
  randomToken,
} from '../src/index.js';

const SECRET = 'an-encryption-secret-of-32-bytes-or-more';
const code = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p);
    return 'no error';
  } catch (e) {
    return e instanceof CryptoError ? e.code : `other: ${e}`;
  }
};
const flip = (bytes: Uint8Array, at: number) => {
  const copy = new Uint8Array(bytes);
  copy[at]! ^= 1;
  return copy;
};

describe('createEncrypter: algorithm', () => {
  test('AES-256-GCM is the default; unknown algorithms are refused', async () => {
    expect(createEncrypter({ secret: SECRET }).algorithm).toBe('AES-256-GCM');
    expect(createEncrypter({ algorithm: 'RSA-OAEP-256' }).algorithm).toBe('RSA-OAEP-256');
    expect(await code(() => createEncrypter({ algorithm: 'DES', secret: SECRET } as never))).toBe(
      'invalid_input',
    );
    expect(await code(createEncrypter({} as never).encrypt('x'))).toBe('invalid_key');
  });
});

describe('createEncrypter: AES-256-GCM', () => {
  const enc = createEncrypter({ secret: SECRET, purpose: 'user.ssn' });

  test('text round trip, and decrypt takes the string or the bytes form', async () => {
    for (const text of ['123-45-6789', '', 'héllo wörld 🔐', 'x'.repeat(100_000)]) {
      expect(await enc.decrypt(await enc.encrypt(text))).toBe(text);
    }
    const asBytes = await enc.encrypt('either form', { as: 'bytes' });
    expect(asBytes).toBeInstanceOf(Uint8Array);
    expect(await enc.decrypt(asBytes)).toBe('either form');
    expect(await enc.decrypt(base64urlEncode(asBytes))).toBe('either form');
  });

  test('bytes round trip with as: bytes', async () => {
    const file = randomBytes(1024);
    const sealed = await enc.encrypt(file, { as: 'bytes' });
    expect(await enc.decrypt(sealed, { as: 'bytes' })).toEqual(file);
    expect(await enc.decrypt(await enc.encrypt(file), { as: 'bytes' })).toEqual(file);
  });

  test('the same input encrypts differently every time, with a fixed overhead', async () => {
    const a = await enc.encrypt('same', { as: 'bytes' });
    const b = await enc.encrypt('same', { as: 'bytes' });
    expect(a).not.toEqual(b);
    expect(a[0]).toBe(1); // format byte
    expect(a.length).toBe(4 + 1 + 12 + 16); // input + format + IV + tag
    expect(await enc.encrypt('x')).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe
  });

  test('any changed byte is detected', async () => {
    const sealed = await enc.encrypt('do not touch', { as: 'bytes' });
    for (let i = 0; i < sealed.length; i++) {
      expect(await code(enc.decrypt(flip(sealed, i)))).toBe('decryption_failed');
    }
    expect(await code(enc.decrypt(sealed.subarray(0, -1)))).toBe('decryption_failed');
  });

  test('secret, purpose and context must all match', async () => {
    const sealed = await enc.encrypt('secret', { context: 'user-1' });
    expect(await enc.decrypt(sealed, { context: 'user-1' })).toBe('secret');
    expect(await code(enc.decrypt(sealed, { context: 'user-2' }))).toBe('decryption_failed');
    expect(await code(enc.decrypt(sealed))).toBe('decryption_failed');
    const otherPurpose = createEncrypter({ secret: SECRET, purpose: 'notes' });
    expect(await code(otherPurpose.decrypt(sealed, { context: 'user-1' }))).toBe(
      'decryption_failed',
    );
    const otherSecret = createEncrypter({ secret: randomToken(32), purpose: 'user.ssn' });
    expect(await code(otherSecret.decrypt(sealed, { context: 'user-1' }))).toBe(
      'decryption_failed',
    );
    const withBytes = await enc.encrypt('x', { context: new Uint8Array([1, 2]) });
    expect(await enc.decrypt(withBytes, { context: new Uint8Array([1, 2]) })).toBe('x');
  });

  test('rotation: previous secrets decrypt, only the current one encrypts', async () => {
    const old = createEncrypter({ secret: SECRET });
    const rotated = createEncrypter({ secret: randomToken(32), previousSecrets: [SECRET] });
    expect(await rotated.decrypt(await old.encrypt('kept'))).toBe('kept');
    expect(await code(old.decrypt(await rotated.encrypt('new')))).toBe('decryption_failed');
  });

  test('weak secrets are refused', async () => {
    expect(await code(createEncrypter({ secret: 'short' }).encrypt('x'))).toBe('weak_key');
    expect(
      await code(createEncrypter({ secret: SECRET, previousSecrets: ['short'] }).encrypt('x')),
    ).toBe('weak_key');
  });

  test('malformed input is always a CryptoError, never something else', async () => {
    for (const bad of ['', 'not base64!', 'AAAA', base64urlEncode(randomBytes(40))]) {
      expect(await code(enc.decrypt(bad))).toBe('decryption_failed');
    }
    for (const bad of [new Uint8Array(0), randomBytes(40), Uint8Array.of(9, ...randomBytes(40))]) {
      expect(await code(enc.decrypt(bad))).toBe('decryption_failed');
    }
    for (const bad of [undefined, null, 42, {}]) {
      expect(await code(enc.decrypt(bad as never))).toBe('decryption_failed');
    }
    // Binary plaintext read back as text.
    const binary = await enc.encrypt(Uint8Array.of(0xff, 0xfe));
    expect(await code(enc.decrypt(binary))).toBe('malformed');
  });

  test('matches an independent AES-256-GCM implementation (node:crypto)', async () => {
    const sealed = await enc.encrypt('interop', { context: 'ctx', as: 'bytes' });
    const key = Buffer.from(
      hkdfSync('sha256', SECRET, 'suku.encrypt.v1', 'suku.encrypt:user.ssn', 32),
    );
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
    decipher.setAAD(Buffer.concat([Buffer.of(1), Buffer.from('ctx')]));
    decipher.setAuthTag(sealed.subarray(-16));
    const plain = Buffer.concat([decipher.update(sealed.subarray(13, -16)), decipher.final()]);
    expect(plain.toString()).toBe('interop');
  });
});

describe('createEncrypter: RSA-OAEP-256', async () => {
  const generate = (modulusLength = 2048, name = 'RSA-OAEP', hash = 'SHA-256') =>
    crypto.subtle.generateKey(
      { name, hash, modulusLength, publicExponent: new Uint8Array([1, 0, 1]) },
      true,
      name === 'RSA-OAEP' ? ['encrypt', 'decrypt'] : ['sign', 'verify'],
    ) as Promise<CryptoKeyPair>;
  const pem = async (label: string, format: 'pkcs8' | 'spki', key: CryptoKey) =>
    `-----BEGIN ${label}-----\n${Buffer.from(await crypto.subtle.exportKey(format, key))
      .toString('base64')
      .match(/.{1,64}/g)!
      .join('\n')}\n-----END ${label}-----\n`;
  const pair = await generate();
  const publicKey = await pem('PUBLIC KEY', 'spki', pair.publicKey);
  const privateKey = await pem('PRIVATE KEY', 'pkcs8', pair.privateKey);
  const rsa = (o: object) => createEncrypter({ algorithm: 'RSA-OAEP-256', ...o });
  const box = rsa({ publicKey, privateKey });

  test('round trip with PEM, JWK and CryptoKey inputs, as text and as bytes', async () => {
    expect(await box.decrypt(await box.encrypt('hello'))).toBe('hello');
    const big = randomBytes(65536);
    expect(await box.decrypt(await box.encrypt(big, { as: 'bytes' }), { as: 'bytes' })).toEqual(
      big,
    );
    const jwk = rsa({
      publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
      privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey),
    });
    expect(await jwk.decrypt(await box.encrypt('from PEM'))).toBe('from PEM');
    const keys = rsa({ publicKey: pair.publicKey, privateKey: pair.privateKey });
    expect(await box.decrypt(await keys.encrypt('from CryptoKey'))).toBe('from CryptoKey');
  });

  test('a service with only the public key can encrypt but not decrypt', async () => {
    const sender = rsa({ publicKey });
    const sealed = await sender.encrypt('for the back office');
    expect(await code(sender.decrypt(sealed))).toBe('invalid_key');
    const reader = rsa({ privateKey });
    expect(await reader.decrypt(sealed)).toBe('for the back office');
    expect(await code(reader.encrypt('x'))).toBe('invalid_key');
  });

  test('wrong key, context or any changed byte fails; previous keys rotate', async () => {
    const sealed = await box.encrypt('private', { context: 'case-7', as: 'bytes' });
    expect(await code(box.decrypt(sealed, { context: 'case-8' }))).toBe('decryption_failed');
    for (const at of [0, 1, 2, 3, 200, 259, 260, sealed.length - 1]) {
      expect(await code(box.decrypt(flip(sealed, at), { context: 'case-7' }))).toBe(
        'decryption_failed',
      );
    }
    const other = await generate();
    expect(await code(rsa({ privateKey: other.privateKey }).decrypt(sealed))).toBe(
      'decryption_failed',
    );
    const rotated = rsa({ privateKey: other.privateKey, previousPrivateKeys: [privateKey] });
    expect(await rotated.decrypt(sealed, { context: 'case-7' })).toBe('private');
  });

  test('a 4096-bit key works (wrapped key longer than 255 bytes)', async () => {
    const large = await generate(4096);
    const box4096 = rsa({ publicKey: large.publicKey, privateKey: large.privateKey });
    const sealed = await box4096.encrypt('big key', { as: 'bytes' });
    expect((sealed[1]! << 8) | sealed[2]!).toBe(512);
    expect(await box4096.decrypt(sealed)).toBe('big key');
  });

  test('keys of the wrong kind or under 2048 bits are refused', async () => {
    const pss = await generate(2048, 'RSA-PSS');
    expect(await code(rsa({ publicKey: pss.publicKey }).encrypt('x'))).toBe('invalid_key');
    const sha1 = await generate(2048, 'RSA-OAEP', 'SHA-1');
    expect(await code(rsa({ publicKey: sha1.publicKey }).encrypt('x'))).toBe('invalid_key');
    const small = await generate(1024);
    expect(await code(rsa({ publicKey: small.publicKey }).encrypt('x'))).toBe('weak_key');
    const legacy = rsa({
      privateKey: '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----',
    });
    expect(await code(legacy.decrypt(await box.encrypt('x')))).toBe('invalid_key');
  });

  test('ciphertexts of the two algorithms are not interchangeable', async () => {
    const aes = createEncrypter({ secret: SECRET });
    expect(await code(box.decrypt(await aes.encrypt('x')))).toBe('decryption_failed');
    expect(await code(aes.decrypt(await box.encrypt('x')))).toBe('decryption_failed');
  });

  test('matches independent RSA-OAEP and AES-256-GCM implementations (node:crypto)', async () => {
    const sealed = base64urlDecode(await box.encrypt('interop', { context: 'ctx' }));
    const end = 3 + ((sealed[1]! << 8) | sealed[2]!);
    const raw = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      sealed.subarray(3, end),
    );
    const decipher = createDecipheriv('aes-256-gcm', raw, sealed.subarray(end, end + 12));
    decipher.setAAD(Buffer.concat([sealed.subarray(0, end), Buffer.from('ctx')]));
    decipher.setAuthTag(sealed.subarray(-16));
    const plain = Buffer.concat([
      decipher.update(sealed.subarray(end + 12, -16)),
      decipher.final(),
    ]);
    expect(plain.toString()).toBe('interop');
  });
});
