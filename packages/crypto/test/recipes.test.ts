// The patterns shown in the documentation's use-cases page, run for real.
import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import sukuCrypto from '../src/index.js';

const SECRET = sukuCrypto.randomToken(32);

test('refresh tokens: store a hash, look up by hash, rotate', async () => {
  const store = new Map<string, { userId: string }>();
  const token = sukuCrypto.randomToken();
  store.set(await sukuCrypto.sha256(token), { userId: 'u1' });
  expect(store.get(await sukuCrypto.sha256(token))?.userId).toBe('u1');
  expect(store.get(await sukuCrypto.sha256(`${token}x`))).toBeUndefined();
  expect(token.length).toBeGreaterThanOrEqual(40);
});

test('login does equal work for unknown users via a dummy hash', async () => {
  const DUMMY_HASH = await sukuCrypto.hashPassword('not-a-real-password', { iterations: 1000 });
  const user = undefined as { passwordHash: string } | undefined;
  expect(await sukuCrypto.verifyPassword('anything', user?.passwordHash ?? DUMMY_HASH)).toBe(false);
});

test('password reset link is single-use by binding to the current password hash', async () => {
  let clock = Date.now();
  const reset = sukuCrypto.createSealer(SECRET, { purpose: 'password-reset', now: () => clock });
  const user = {
    id: 'u1',
    passwordHash: await sukuCrypto.hashPassword('old', { iterations: 1000 }),
  };
  const token = await reset.seal(
    { id: user.id, v: await sukuCrypto.sha256(user.passwordHash) },
    { ttl: '30m' },
  );

  const check = async () => {
    const data = await reset.unseal<{ id: string; v: string }>(token);
    return data !== undefined && data.v === (await sukuCrypto.sha256(user.passwordHash));
  };
  expect(await check()).toBe(true);
  user.passwordHash = await sukuCrypto.hashPassword('new', { iterations: 1000 });
  expect(await check()).toBe(false); // the link died when the password changed
  clock += 31 * 60_000;
  expect(await reset.unseal(token)).toBeUndefined();
  expect(
    await sukuCrypto.createSealer(SECRET, { purpose: 'team-invite' }).unseal(token),
  ).toBeUndefined();
});

test('webhooks: base64url verify, and hex-with-prefix providers', async () => {
  const raw = JSON.stringify({ event: 'paid', id: 1 });
  const signer = sukuCrypto.createSigner(SECRET);
  expect(
    await signer.verify(raw, createHmac('sha256', SECRET).update(raw).digest('base64url')),
  ).toBe(true);

  const provided = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
  const expected = `sha256=${sukuCrypto.hexEncode(sukuCrypto.base64urlDecode(await signer.sign(raw)))}`;
  expect(sukuCrypto.timingSafeEqual(expected, provided)).toBe(true);
  expect(sukuCrypto.timingSafeEqual(expected, provided.replace(/.$/, '0'))).toBe(
    provided.endsWith('0'),
  );
});

test('one-time codes are six digits and verified by hash', async () => {
  for (let i = 0; i < 50; i++) {
    const code = String(sukuCrypto.randomInt(0, 1_000_000)).padStart(6, '0');
    expect(code).toMatch(/^\d{6}$/);
  }
  const hash = await sukuCrypto.sha256('u1:042917');
  expect(sukuCrypto.timingSafeEqual(hash, await sukuCrypto.sha256('u1:042917'))).toBe(true);
  expect(sukuCrypto.timingSafeEqual(hash, await sukuCrypto.sha256('u1:042918'))).toBe(false);
});

test('OAuth state round trip with a nonce, and API key prefix', async () => {
  const State = sukuCrypto.createSealer(SECRET, { purpose: 'oauth-state' });
  const nonce = sukuCrypto.randomToken(16);
  const state = await State.seal({ nonce, returnTo: '/dashboard' }, { ttl: '10m' });
  const data = await State.unseal<{ nonce: string; returnTo: string }>(state);
  expect(data && sukuCrypto.timingSafeEqual(data.nonce, nonce)).toBe(true);
  const key = `sk_${sukuCrypto.randomToken()}`;
  expect(key.slice(0, 7)).toMatch(/^sk_[A-Za-z0-9_-]{4}$/);
});

test('sealed size stays near 4/3 of the JSON plus about 50 characters', async () => {
  const sealer = sukuCrypto.createSealer(SECRET);
  for (const n of [10, 200, 1000]) {
    const json = JSON.stringify('x'.repeat(n));
    const sealed = await sealer.seal('x'.repeat(n));
    const overhead = sealed.length - Math.ceil((json.length * 4) / 3);
    expect(overhead).toBeGreaterThan(40);
    expect(overhead).toBeLessThan(60);
  }
});
