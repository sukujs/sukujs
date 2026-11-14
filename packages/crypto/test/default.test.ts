import { expect, test } from 'bun:test';
import sukuCrypto, * as named from '../src/index.js';

test('the default export carries every function, identical to the named exports', async () => {
  const { default: _default, ...rest } = named;
  const functions = Object.entries(rest).filter(([, v]) => typeof v === 'function');
  expect(functions.length).toBeGreaterThan(20);
  for (const [name, fn] of functions) {
    if (name === 'DEFAULT_PASSWORD_ITERATIONS') continue;
    expect((sukuCrypto as Record<string, unknown>)[name]).toBe(fn);
  }
  const hash = await sukuCrypto.hashPassword('pw', { iterations: 1000 });
  expect(await sukuCrypto.verifyPassword('pw', hash)).toBe(true);
  const jwt = sukuCrypto.createJwt({ secret: sukuCrypto.randomToken(32) });
  expect((await jwt.verify(await jwt.sign({ sub: '1' }))).sub).toBe('1');
});
