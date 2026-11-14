import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import {
  base64urlEncode,
  bearerToken,
  createJwt,
  decodeJwtUnverified,
  type JwtAlgorithm,
  JwtError,
  randomToken,
} from '../src/index.js';

const SECRET = 'a-secret-that-is-at-least-32-bytes-long!';
const b64 = (v: unknown) => base64urlEncode(JSON.stringify(v));
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return e instanceof JwtError ? e.code : `other: ${e}`;
  }
};

async function pemPair(algorithm: object, usages: KeyUsage[] = ['sign', 'verify']) {
  const pair = (await crypto.subtle.generateKey(
    algorithm as AlgorithmIdentifier,
    true,
    usages,
  )) as CryptoKeyPair;
  const wrap = (label: string, der: ArrayBuffer) =>
    `-----BEGIN ${label}-----\n${Buffer.from(der)
      .toString('base64')
      .match(/.{1,64}/g)!
      .join('\n')}\n-----END ${label}-----\n`;
  return {
    pair,
    privateKey: wrap('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    publicKey: wrap('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey)),
  };
}

describe('HS256', () => {
  let clock = 1_700_000_000_000;
  const jwt = createJwt<{ role: string }>({
    secret: SECRET,
    issuer: 'api',
    audience: 'web',
    expiresIn: '15m',
    now: () => clock,
  });

  test('sign and verify round trip with registered claims', async () => {
    const token = await jwt.sign({ role: 'admin' }, { subject: 'u1', jwtId: 'j1' });
    const payload = await jwt.verify(token);
    expect(payload).toEqual({
      role: 'admin',
      sub: 'u1',
      jti: 'j1',
      iss: 'api',
      aud: 'web',
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    });
    expect(decodeJwtUnverified(token).header).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  test('signature matches an independent HMAC implementation', async () => {
    const token = await jwt.sign({ role: 'x' });
    const [h, p, s] = token.split('.');
    expect(s).toBe(createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url'));
  });

  test('tampered payload, signature, and wrong secret are rejected', async () => {
    const token = await jwt.sign({ role: 'user' });
    const [h, , s] = token.split('.') as [string, string, string];
    const forged = `${h}.${b64({ role: 'admin', exp: 9_999_999_999 })}.${s}`;
    expect(await code(jwt.verify(forged))).toBe('invalid_signature');
    expect(await code(jwt.verify(`${token.slice(0, -2)}AA`))).toBe('invalid_signature');
    const other = createJwt({ secret: `${SECRET}x`, issuer: 'api', audience: 'web' });
    expect(await code(other.verify(token))).toBe('invalid_signature');
  });

  test('alg none and unsigned tokens are rejected', async () => {
    const body = b64({ role: 'admin', exp: 9_999_999_999, iss: 'api', aud: 'web' });
    expect(await code(jwt.verify(`${b64({ alg: 'none', typ: 'JWT' })}.${body}.`))).toBe(
      'algorithm_mismatch',
    );
    expect(await code(jwt.verify(`${b64({ alg: 'None' })}.${body}.`))).toBe('algorithm_mismatch');
    expect(await code(jwt.verify(`${b64({ alg: 'HS256' })}.${body}.`))).toBe('invalid_signature');
  });

  test('expiry, not-before, future iat, and clock tolerance', async () => {
    const token = await jwt.sign({ role: 'a' }, { notBefore: '1m' });
    expect(await code(jwt.verify(token))).toBe('not_active');
    clock += 60_000;
    expect((await jwt.verify(token)).role).toBe('a');
    clock += 14 * 60_000;
    expect(await code(jwt.verify(token))).toBe('expired');
    const lenient = createJwt({
      secret: SECRET,
      issuer: 'api',
      audience: 'web',
      clockTolerance: 30,
      now: () => clock,
    });
    expect((await lenient.verify(token)).role).toBe('a');
    clock = 1_700_000_000_000;
    const plain = await jwt.sign({ role: 'a' });
    clock -= 5 * 60_000;
    expect(await code(jwt.verify(plain))).toBe('invalid_claim'); // issued in the future
    clock = 1_700_000_000_000;
  });

  test('issuer and audience must match', async () => {
    const token = await jwt.sign({ role: 'a' });
    expect(
      await code(
        createJwt({ secret: SECRET, issuer: 'other', audience: 'web', now: () => clock }).verify(
          token,
        ),
      ),
    ).toBe('invalid_claim');
    expect(
      await code(
        createJwt({ secret: SECRET, issuer: 'api', audience: 'mobile', now: () => clock }).verify(
          token,
        ),
      ),
    ).toBe('invalid_claim');
    const multi = createJwt({
      secret: SECRET,
      issuer: 'api',
      audience: ['mobile', 'web'],
      now: () => clock,
    });
    expect(await code(multi.verify(token))).toBe('no error');
  });

  test('tokens without exp are rejected unless expiry is disabled', async () => {
    const forever = createJwt({ secret: SECRET, expiresIn: false });
    const token = await forever.sign({ a: 1 });
    expect((await forever.verify(token)).exp).toBeUndefined();
    expect(await code(createJwt({ secret: SECRET }).verify(token))).toBe('invalid_claim');
  });

  test('malformed input never throws anything but JwtError', async () => {
    for (const bad of [
      '',
      'a',
      'a.b',
      'a.b.c.d',
      '!!!.###.$$$',
      `${b64([1])}.${b64({})}.x`,
      'x'.repeat(9000),
    ]) {
      expect(await code(jwt.verify(bad))).toBe('malformed');
    }
    expect(await code(jwt.verify(undefined as unknown as string))).toBe('malformed');
    const crit = `${b64({ alg: 'HS256', crit: ['x'] })}.${b64({})}.AAAA`;
    expect(await code(jwt.verify(crit))).toBe('malformed');
  });

  test('weak secrets are refused; rotation accepts previous secrets for verify only', async () => {
    expect(await code(createJwt({ secret: 'short' }).sign({}))).toBe('weak_key');
    expect(await code(createJwt({ algorithm: 'HS512', secret: SECRET }).sign({}))).toBe('weak_key');
    const old = createJwt({ secret: SECRET });
    const rotated = createJwt({ secret: randomToken(32), previousSecrets: [SECRET] });
    expect(await code(rotated.verify(await old.sign({ a: 1 })))).toBe('no error');
    expect(await code(old.verify(await rotated.sign({ a: 1 })))).toBe('invalid_signature');
  });

  test('schema validates and types the payload', async () => {
    const schema = {
      '~standard': {
        validate: (v: unknown) =>
          typeof (v as { role?: unknown }).role === 'string'
            ? { value: v as { role: string } }
            : { issues: [{ message: 'role must be a string' }] },
      },
    };
    const typed = createJwt({ secret: SECRET, schema });
    expect((await typed.verify(await typed.sign({ role: 'a' }))).role).toBe('a');
    const loose = createJwt<Record<string, unknown>>({ secret: SECRET });
    expect(await code(typed.verify(await loose.sign({ role: 5 })))).toBe('invalid_claim');
  });

  test('bearerToken parses the Authorization header', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer   abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken('Bearer a b')).toBeUndefined();
    expect(bearerToken(null)).toBeUndefined();
  });
});

describe('asymmetric algorithms', () => {
  const rsa = { modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
  const cases: [JwtAlgorithm, object][] = [
    ['RS256', { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', ...rsa }],
    ['PS384', { name: 'RSA-PSS', hash: 'SHA-384', ...rsa }],
    ['ES256', { name: 'ECDSA', namedCurve: 'P-256' }],
    ['ES384', { name: 'ECDSA', namedCurve: 'P-384' }],
    ['EdDSA', { name: 'Ed25519' }],
  ];

  for (const [algorithm, params] of cases) {
    test(`${algorithm}: PEM keys, verify-only service, wrong key rejected`, async () => {
      const keys = await pemPair(params);
      const issuer = createJwt({
        algorithm,
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
      } as never);
      const verifier = createJwt({ algorithm, publicKey: keys.publicKey } as never);
      const token = await issuer.sign({ sub: '1' });
      expect((await verifier.verify(token)).sub).toBe('1');
      expect(await code(verifier.sign({}))).toBe('invalid_key');
      const stranger = await pemPair(params);
      expect(
        await code(createJwt({ algorithm, publicKey: stranger.publicKey } as never).verify(token)),
      ).toBe('invalid_signature');
      const rotated = createJwt({
        algorithm,
        publicKey: stranger.publicKey,
        previousPublicKeys: [keys.publicKey],
      } as never);
      expect(await code(rotated.verify(token))).toBe('no error');
    });
  }

  test('key confusion: an HS256 token signed with the RSA public key is rejected', async () => {
    const keys = await pemPair({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', ...rsa });
    const verifier = createJwt({ algorithm: 'RS256', publicKey: keys.publicKey });
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ sub: 'admin', exp: 9_999_999_999 });
    const sig = createHmac('sha256', keys.publicKey).update(`${head}.${body}`).digest('base64url');
    expect(await code(verifier.verify(`${head}.${body}.${sig}`))).toBe('algorithm_mismatch');
  });

  test('CryptoKey and JWK inputs; legacy PEM formats get a helpful error', async () => {
    const { pair } = await pemPair({ name: 'ECDSA', namedCurve: 'P-256' });
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const issuer = createJwt({ algorithm: 'ES256', privateKey: pair.privateKey, publicKey: jwk });
    expect((await issuer.verify(await issuer.sign({ a: 1 }))).a).toBe(1);
    const legacy = createJwt({
      algorithm: 'RS256',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----',
    });
    await expect(legacy.sign({})).rejects.toThrow(/openssl pkcs8/);
  });
});
