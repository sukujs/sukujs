import { describe, expect, test } from 'bun:test';
import { createDecipheriv, hkdfSync, privateDecrypt, constants } from 'node:crypto';
import {
  base64urlDecode,
  base64urlEncode,
  createEncrypter,
  createPublicKeyEncrypter,
  CryptoError,
  randomBytes,
  randomToken,
} from '../src/index.js';

const SECRET = 'an-encryption-secret-of-32-bytes-or-more';
const code = async (p: Promise<unknown>) => {
  try {
    await p;
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

describe('createEncrypter', () => {
  const enc = createEncrypter(SECRET, { purpose: 'user.ssn' });

  test('text and bytes round trip', async () => {
    for (const text of ['123-45-6789', '', 'héllo wörld 🔐', 'x'.repeat(100_000)]) {
      expect(await enc.decrypt(await enc.encrypt(text))).toBe(text);
    }
    const bytes = randomBytes(1024);
    expect(await enc.decryptBytes(await enc.encryptBytes(bytes))).toEqual(bytes);
    // Strings can go in as bytes and come out as text, and the other way round.
    expect(await enc.decrypt(base64urlEncode(await enc.encryptBytes('as bytes')))).toBe('as bytes');
  });

  test('the same input encrypts differently every time, with a fixed overhead', async () => {
    const a = await enc.encryptBytes('same');
    const b = await enc.encryptBytes('same');
    expect(a).not.toEqual(b);
    expect(a[0]).toBe(1); // format byte
    expect(a.length).toBe(4 + 1 + 12 + 16); // input + format + IV + tag
    expect(await enc.encrypt('x')).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe
  });

  test('any changed byte is detected', async () => {
    const sealed = await enc.encryptBytes('do not touch');
    for (let i = 0; i < sealed.length; i++) {
      expect(await code(enc.decryptBytes(flip(sealed, i)))).toBe('decryption_failed');
    }
    expect(await code(enc.decryptBytes(sealed.subarray(0, -1)))).toBe('decryption_failed');
  });

  test('secret, purpose and context must all match', async () => {
    const sealed = await enc.encrypt('secret', { context: 'user-1' });
    expect(await enc.decrypt(sealed, { context: 'user-1' })).toBe('secret');
    expect(await code(enc.decrypt(sealed, { context: 'user-2' }))).toBe('decryption_failed');
    expect(await code(enc.decrypt(sealed))).toBe('decryption_failed');
    const otherPurpose = createEncrypter(SECRET, { purpose: 'notes' });
    expect(await code(otherPurpose.decrypt(sealed, { context: 'user-1' }))).toBe(
      'decryption_failed',
    );
    const otherSecret = createEncrypter(randomToken(32), { purpose: 'user.ssn' });
    expect(await code(otherSecret.decrypt(sealed, { context: 'user-1' }))).toBe(
      'decryption_failed',
    );
    // Bytes work as context too.
    const withBytes = await enc.encrypt('x', { context: new Uint8Array([1, 2]) });
    expect(await enc.decrypt(withBytes, { context: new Uint8Array([1, 2]) })).toBe('x');
  });

  test('rotation: previous secrets decrypt, only the current one encrypts', async () => {
    const old = createEncrypter(SECRET);
    const rotated = createEncrypter(randomToken(32), { previousSecrets: [SECRET] });
    expect(await rotated.decrypt(await old.encrypt('kept'))).toBe('kept');
    expect(await code(old.decrypt(await rotated.encrypt('new')))).toBe('decryption_failed');
  });

  test('weak secrets are refused', async () => {
    expect(await code(createEncrypter('short').encrypt('x'))).toBe('weak_key');
    expect(await code(createEncrypter(SECRET, { previousSecrets: ['short'] }).encrypt('x'))).toBe(
      'weak_key',
    );
  });

  test('malformed input is always a CryptoError, never something else', async () => {
    for (const bad of ['', 'not base64!', 'AAAA', base64urlEncode(randomBytes(40))]) {
      expect(await code(enc.decrypt(bad))).toBe('decryption_failed');
    }
    for (const bad of [new Uint8Array(0), randomBytes(40), Uint8Array.of(9, ...randomBytes(40))]) {
      expect(await code(enc.decryptBytes(bad))).toBe('decryption_failed');
    }
    for (const bad of [undefined, null, 42, {}]) {
      expect(await code(enc.decrypt(bad as never))).toBe('decryption_failed');
      expect(await code(enc.decryptBytes(bad as never))).toBe('decryption_failed');
    }
    // Binary plaintext read back as text.
    const binary = await enc.encrypt(Uint8Array.of(0xff, 0xfe));
    expect(await code(enc.decrypt(binary))).toBe('malformed');
  });

  test('matches an independent AES-256-GCM implementation (node:crypto)', async () => {
    const sealed = await enc.encryptBytes('interop', { context: 'ctx' });
    const key = Buffer.from(
      hkdfSync('sha256', SECRET, 'suku.encrypt.v1', 'suku.encrypt:user.ssn', 32),
    );
    const iv = sealed.subarray(1, 13);
    const body = sealed.subarray(13, -16);
    const tag = sealed.subarray(-16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.concat([Buffer.of(1), Buffer.from('ctx')]));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString();
    expect(plain).toBe('interop');
  });
});

describe('createPublicKeyEncrypter', async () => {
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
  const publicPem = await pem('PUBLIC KEY', 'spki', pair.publicKey);
  const privatePem = await pem('PRIVATE KEY', 'pkcs8', pair.privateKey);
  const box = createPublicKeyEncrypter({ publicKey: publicPem, privateKey: privatePem });

  test('round trip with PEM, JWK and CryptoKey inputs', async () => {
    expect(await box.decrypt(await box.encrypt('hello'))).toBe('hello');
    const big = randomBytes(65536);
    expect(await box.decryptBytes(await box.encryptBytes(big))).toEqual(big);
    const jwk = createPublicKeyEncrypter({
      publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
      privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey),
    });
    expect(await jwk.decrypt(await box.encrypt('from PEM'))).toBe('from PEM');
    const keys = createPublicKeyEncrypter({
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    });
    expect(await box.decrypt(await keys.encrypt('from CryptoKey'))).toBe('from CryptoKey');
  });

  test('a service with only the public key can encrypt but not decrypt', async () => {
    const sender = createPublicKeyEncrypter({ publicKey: publicPem });
    const sealed = await sender.encrypt('for the back office');
    expect(await code(sender.decrypt(sealed))).toBe('invalid_key');
    const reader = createPublicKeyEncrypter({ privateKey: privatePem });
    expect(await reader.decrypt(sealed)).toBe('for the back office');
    expect(await code(reader.encrypt('x'))).toBe('invalid_key');
  });

  test('wrong key, context or any changed byte fails; previous keys rotate', async () => {
    const sealed = await box.encryptBytes('private', { context: 'case-7' });
    expect(await code(box.decryptBytes(sealed, { context: 'case-8' }))).toBe('decryption_failed');
    for (const at of [0, 1, 2, 3, 200, 259, 260, sealed.length - 1]) {
      expect(await code(box.decryptBytes(flip(sealed, at), { context: 'case-7' }))).toBe(
        'decryption_failed',
      );
    }
    const other = await generate();
    const stranger = createPublicKeyEncrypter({ privateKey: other.privateKey });
    expect(await code(stranger.decryptBytes(sealed, { context: 'case-7' }))).toBe(
      'decryption_failed',
    );
    const rotated = createPublicKeyEncrypter({
      privateKey: other.privateKey,
      previousPrivateKeys: [privatePem],
    });
    expect(await rotated.decryptBytes(sealed, { context: 'case-7' })).toEqual(
      new TextEncoder().encode('private'),
    );
  });

  test('a 4096-bit key works (wrapped key longer than 255 bytes)', async () => {
    const large = await generate(4096);
    const box4096 = createPublicKeyEncrypter({
      publicKey: large.publicKey,
      privateKey: large.privateKey,
    });
    const sealed = await box4096.encryptBytes('big key');
    expect((sealed[1]! << 8) | sealed[2]!).toBe(512);
    expect(await box4096.decrypt(base64urlEncode(sealed))).toBe('big key');
  });

  test('keys of the wrong kind or under 2048 bits are refused', async () => {
    const pss = await generate(2048, 'RSA-PSS');
    expect(await code(createPublicKeyEncrypter({ publicKey: pss.publicKey }).encrypt('x'))).toBe(
      'invalid_key',
    );
    const sha1 = await generate(2048, 'RSA-OAEP', 'SHA-1');
    expect(await code(createPublicKeyEncrypter({ publicKey: sha1.publicKey }).encrypt('x'))).toBe(
      'invalid_key',
    );
    const small = await generate(1024);
    expect(await code(createPublicKeyEncrypter({ publicKey: small.publicKey }).encrypt('x'))).toBe(
      'weak_key',
    );
    expect(
      await code(
        createPublicKeyEncrypter({
          privateKey: '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----',
        }).decrypt(await box.encrypt('x')),
      ),
    ).toBe('invalid_key');
  });

  test('the two kinds of ciphertext are not interchangeable', async () => {
    const symmetric = createEncrypter(SECRET);
    expect(await code(box.decrypt(await symmetric.encrypt('x')))).toBe('decryption_failed');
    expect(await code(symmetric.decrypt(await box.encrypt('x')))).toBe('decryption_failed');
  });

  test('matches independent RSA-OAEP and AES-256-GCM implementations (node:crypto)', async () => {
    const sealed = base64urlDecode(await box.encrypt('interop', { context: 'ctx' }));
    const end = 3 + ((sealed[1]! << 8) | sealed[2]!);
    const raw = privateDecrypt(
      { key: privatePem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
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
