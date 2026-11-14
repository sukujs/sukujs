import { describe, expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import {
  base64urlDecode,
  base64urlEncode,
  CryptoError,
  createSealer,
  createSigner,
  hashPassword,
  needsRehash,
  randomBytes,
  randomHex,
  randomInt,
  randomToken,
  randomUUID,
  sha256,
  sha512,
  timingSafeEqual,
  toSeconds,
  verifyPassword,
} from '../src/index.js';

const SECRET = 'a-secret-that-is-at-least-32-bytes-long!';
const FAST = { iterations: 1000 };

describe('passwords', () => {
  test('hash format, verify, and unique salts', async () => {
    const hash = await hashPassword('correct horse', FAST);
    expect(hash).toMatch(/^\$pbkdf2-sha256\$i=1000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('correct horsf', hash)).toBe(false);
    expect(await hashPassword('correct horse', FAST)).not.toBe(hash);
  });

  test('matches an independent PBKDF2 implementation', async () => {
    const { pbkdf2Sync } = await import('node:crypto');
    const hash = await hashPassword('pässword', FAST);
    const [, , , salt, digest] = hash.split('$') as [string, string, string, string, string];
    const expected = pbkdf2Sync(
      'pässword'.normalize('NFKC'),
      base64urlDecode(salt),
      1000,
      32,
      'sha256',
    );
    expect(digest).toBe(expected.toString('base64url'));
  });

  test('malformed stored values are false, never an error; needsRehash tracks the work factor', async () => {
    for (const bad of [
      '',
      'plain',
      '$pbkdf2-sha256$i=0$a$b',
      '$pbkdf2-sha256$i=99999999999$a$b',
      '$pbkdf2-sha256$i=10$!$b',
      '$bcrypt$x',
    ]) {
      expect(await verifyPassword('x', bad)).toBe(false);
    }
    const hash = await hashPassword('x', FAST);
    expect(needsRehash(hash, FAST)).toBe(false);
    expect(needsRehash(hash)).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
    await expect(hashPassword('')).rejects.toBeInstanceOf(CryptoError);
  });

  test('the default work factor is the OWASP minimum', async () => {
    const hash = await hashPassword('default');
    expect(hash).toContain('$i=600000$');
    expect(await verifyPassword('default', hash)).toBe(true);
  });
});

describe('signer', () => {
  const signer = createSigner(SECRET);

  test('sign matches node:crypto, verify is strict', async () => {
    const sig = await signer.sign('hello');
    expect(sig).toBe(createHmac('sha256', SECRET).update('hello').digest('base64url'));
    expect(await signer.verify('hello', sig)).toBe(true);
    expect(await signer.verify('hellp', sig)).toBe(false);
    expect(await signer.verify('hello', 'not base64!')).toBe(false);
    expect(await signer.verify('hello', '')).toBe(false);
  });

  test('pack and unpack; values containing dots; rotation', async () => {
    const packed = await signer.pack('user.42');
    expect(await signer.unpack(packed)).toBe('user.42');
    expect(await signer.unpack(packed.replace('42', '43'))).toBeUndefined();
    expect(await signer.unpack('nodot')).toBeUndefined();
    const rotated = createSigner(randomToken(32), { previousSecrets: [SECRET] });
    expect(await rotated.unpack(packed)).toBe('user.42');
    expect(await signer.unpack(await rotated.pack('x'))).toBeUndefined();
    await expect(createSigner('short').sign('x')).rejects.toThrow(/at least 32 bytes/);
  });
});

describe('sealer', () => {
  let clock = 1_700_000_000_000;
  const sealer = createSealer(SECRET, { purpose: 'session', now: () => clock });

  test('round trip hides the value and never repeats', async () => {
    const value = { userId: 7, roles: ['admin'], note: 'ünïcode' };
    const a = await sealer.seal(value);
    const b = await sealer.seal(value);
    expect(a).not.toBe(b);
    expect(a).not.toContain('admin');
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(await sealer.unseal<typeof value>(a)).toEqual(value);
  });

  test('tampering, wrong secret, wrong purpose and garbage all yield undefined', async () => {
    const sealed = await sealer.seal('secret');
    const flipped = sealed.slice(0, -1) + (sealed.endsWith('A') ? 'B' : 'A');
    expect(await sealer.unseal(flipped)).toBeUndefined();
    expect(await createSealer(`${SECRET}x`, { purpose: 'session' }).unseal(sealed)).toBeUndefined();
    expect(await createSealer(SECRET, { purpose: 'reset' }).unseal(sealed)).toBeUndefined();
    for (const bad of ['', 'v1.a.b', 'v2.x.y', 'nope', 'v1.!!.??'])
      expect(await sealer.unseal(bad)).toBeUndefined();
    expect(await sealer.unseal(undefined as unknown as string)).toBeUndefined();
  });

  test('ttl expiry and secret rotation', async () => {
    const sealed = await sealer.seal({ a: 1 }, { ttl: '10m' });
    clock += 9 * 60_000;
    expect(await sealer.unseal(sealed)).toEqual({ a: 1 });
    clock += 60_000;
    expect(await sealer.unseal(sealed)).toBeUndefined();
    clock = 1_700_000_000_000;
    const rotated = createSealer(randomToken(32), {
      purpose: 'session',
      previousSecrets: [SECRET],
    });
    expect(await rotated.unseal(await sealer.seal('old'))).toBe('old');
    await expect(createSealer('short').seal(1)).rejects.toThrow(/at least 32 bytes/);
  });
});

describe('helpers', () => {
  test('random values have the right shape and do not repeat', () => {
    expect(randomBytes(16)).toHaveLength(16);
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomHex(8)).toMatch(/^[0-9a-f]{16}$/);
    expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(Array.from({ length: 200 }, () => randomToken())).size).toBe(200);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const n = randomInt(5, 8);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThan(8);
      seen.add(n);
    }
    expect(seen.size).toBe(3);
    expect(() => randomInt(3, 3)).toThrow(CryptoError);
    expect(() => randomBytes(-1)).toThrow(CryptoError);
  });

  test('hashes match node:crypto', async () => {
    expect(await sha256('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
    expect(await sha512('abc')).toBe(createHash('sha512').update('abc').digest('hex'));
  });

  test('base64url round trips and rejects invalid input', () => {
    for (const s of ['', 'f', 'fo', 'foo', 'foob', 'ünïcode ✓']) {
      expect(new TextDecoder().decode(base64urlDecode(base64urlEncode(s)))).toBe(s);
    }
    const big = randomBytes(40000);
    expect(base64urlDecode(base64urlEncode(big))).toEqual(big);
    expect(() => base64urlDecode('a+b/')).toThrow(CryptoError);
    expect(() => base64urlDecode('a')).toThrow(CryptoError);
  });

  test('timingSafeEqual and durations', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
    expect([
      toSeconds(90),
      toSeconds('30s'),
      toSeconds('15m'),
      toSeconds('2h'),
      toSeconds('7d'),
      toSeconds('1w'),
    ]).toEqual([90, 30, 900, 7200, 604800, 604800]);
    expect(() => toSeconds('soon' as never)).toThrow(CryptoError);
    expect(() => toSeconds(-1)).toThrow(CryptoError);
  });
});
