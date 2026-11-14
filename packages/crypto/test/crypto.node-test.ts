// Runs on real Node via `node --test`, to exercise Node's own Web Crypto implementation.
// Imports the built package, because Node cannot map the sources' `.js` imports to `.ts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createJwt,
  createSealer,
  createSigner,
  hashPassword,
  verifyPassword,
} from '@sukujs/crypto';

const SECRET = 'a-secret-that-is-at-least-32-bytes-long!';

test('JWT HS256 and EdDSA round trip on Node', async () => {
  const hs = createJwt({ secret: SECRET, issuer: 'api' });
  assert.equal((await hs.verify(await hs.sign({ sub: '1' }))).sub, '1');
  await assert.rejects(hs.verify(`${await hs.sign({})}x`), { code: 'invalid_signature' });

  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const ed = createJwt({
    algorithm: 'EdDSA',
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
  });
  assert.equal((await ed.verify(await ed.sign({ sub: '2' }))).sub, '2');

  const ec = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-521' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const es512 = createJwt({
    algorithm: 'ES512',
    privateKey: ec.privateKey,
    publicKey: ec.publicKey,
  });
  assert.equal((await es512.verify(await es512.sign({ sub: '3' }))).sub, '3');
});

test('password, signer and sealer on Node', async () => {
  const hash = await hashPassword('pw', { iterations: 1000 });
  assert.equal(await verifyPassword('pw', hash), true);
  assert.equal(await verifyPassword('pw2', hash), false);
  const signer = createSigner(SECRET);
  assert.equal(await signer.unpack(await signer.pack('v')), 'v');
  const sealer = createSealer(SECRET);
  assert.deepEqual(await sealer.unseal(await sealer.seal({ a: [1, 2] })), { a: [1, 2] });
});
