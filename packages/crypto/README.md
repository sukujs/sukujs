# @suku/crypto

Zero-dependency crypto helpers on the Web Crypto API. Works on Node 22+, Bun and edge
runtimes, with or without the rest of Suku.

```ts
import {
  createJwt,
  hashPassword,
  verifyPassword,
  createSigner,
  createSealer,
  randomToken,
} from '@suku/crypto';

const jwt = createJwt<{ role: string }>({
  secret: env.JWT_SECRET,
  issuer: 'api',
  expiresIn: '15m',
});
const token = await jwt.sign({ role: 'admin' }, { subject: user.id });
const payload = await jwt.verify(token); // throws JwtError if not trustworthy

const stored = await hashPassword(password);
await verifyPassword(password, stored); // true or false

const signed = await createSigner(env.COOKIE_SECRET).pack('user.42'); // readable, tamper-proof
const sealed = await createSealer(env.COOKIE_SECRET).seal({ id: 42 }); // encrypted
```

| Area                | API                                                                  |
| ------------------- | -------------------------------------------------------------------- |
| JWT                 | `createJwt`, `bearerToken`, `decodeJwtUnverified`                    |
| Passwords           | `hashPassword`, `verifyPassword`, `needsRehash`                      |
| Signed values       | `createSigner` (HMAC): `sign`, `verify`, `pack`, `unpack`            |
| Encrypted values    | `createSealer` (AES-256-GCM): `seal`, `unseal`, with optional `ttl`  |
| Random              | `randomToken`, `randomBytes`, `randomHex`, `randomUUID`, `randomInt` |
| Hashing and compare | `sha256`, `sha512`, `digest`, `timingSafeEqual`                      |

## JWT

### `createJwt`

Creates a signer/verifier bound to one algorithm and one set of keys. The algorithm is fixed
at creation time and never read from a token.

```ts
import { createJwt, randomToken } from '@suku/crypto';

// HMAC (default HS256) — secret must be at least 32 bytes for HS256
const jwt = createJwt<{ role: string }>({
  secret: env.JWT_SECRET, // or randomToken(32)
  issuer: 'api',
  audience: 'web',
  expiresIn: '15m', // default '1h'; use false for non-expiring tokens
});

// Asymmetric — sign with privateKey, verify with publicKey
const rsa = createJwt({
  algorithm: 'RS256',
  privateKey: process.env.JWT_PRIVATE_PEM, // PKCS#8 PEM
  publicKey: process.env.JWT_PUBLIC_PEM, // SPKI PEM
  issuer: 'api',
});

// Key rotation — old keys verify, never sign
const rotated = createJwt({
  secret: env.JWT_SECRET,
  previousSecrets: [env.JWT_SECRET_OLD],
});
```

### `jwt.sign`

Signs a payload with the algorithm and secret (or private key) already set on `createJwt` —
you do not pass them again. Adds `iat`, `exp`, and the configured `iss` / `aud`.

```ts
// algorithm + secret come from createJwt above (default HS256 + secret)
const token = await jwt.sign(
  { role: 'admin' },
  {
    subject: user.id, // sets `sub`
    expiresIn: '5m', // override default lifetime
    notBefore: '30s', // rejected until then
    jwtId: randomToken(16), // sets `jti`
  },
);
```

### `jwt.verify`

Verifies signature and claims. Throws `JwtError` on failure — treat a failed token as absent.

```ts
try {
  const payload = await jwt.verify(token);
  // payload.role, payload.sub, payload.exp, …
} catch (err) {
  if (err instanceof JwtError) {
    // expired | invalid_signature | invalid_claim | …
  }
  throw err;
}
```

### `bearerToken`

Extracts the token from an `Authorization: Bearer <token>` header value.

```ts
import { bearerToken } from '@suku/crypto';

const token = bearerToken(request.headers.get('authorization'));
if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });

const payload = await jwt.verify(token);
```

### `decodeJwtUnverified`

Reads header and payload **without verifying anything**. Attacker-controlled — use only to
pick a key or to log; never to authorize.

```ts
import { decodeJwtUnverified } from '@suku/crypto';

const { header, payload } = decodeJwtUnverified(token);
console.log(header.kid, payload.sub); // do not trust these for access control
```

## Passwords

PBKDF2-HMAC-SHA256 with 600,000 iterations and a 16-byte random salt, stored as
`$pbkdf2-sha256$i=600000$<salt>$<hash>`. It is the password KDF every Web Crypto runtime
has. If you can take a native dependency, Argon2id is stronger.

### `hashPassword`

```ts
import { hashPassword } from '@suku/crypto';

const stored = await hashPassword(password);
// "$pbkdf2-sha256$i=600000$…"

// Raise the work factor over time
const stronger = await hashPassword(password, { iterations: 800_000 });
```

### `verifyPassword`

Returns `true` only on a match. Malformed stored values return `false`, never throw.

```ts
import { verifyPassword } from '@suku/crypto';

if (!(await verifyPassword(password, user.passwordHash))) {
  return Response.json({ error: 'invalid credentials' }, { status: 401 });
}
```

### `needsRehash`

`true` when the stored hash uses fewer iterations than you now want. Rehash after a
successful login.

```ts
import { hashPassword, needsRehash, verifyPassword } from '@suku/crypto';

if (await verifyPassword(password, user.passwordHash)) {
  if (needsRehash(user.passwordHash, { iterations: 800_000 })) {
    user.passwordHash = await hashPassword(password, { iterations: 800_000 });
  }
}
```

## Signed values (`createSigner`)

HMAC for values that must not be tampered with: cookies, webhook payloads, unsubscribe
links. The value stays readable; use `createSealer` to hide it. Secret must be ≥ 32 bytes.

### `createSigner`

```ts
import { createSigner, randomToken } from '@suku/crypto';

const signer = createSigner(env.COOKIE_SECRET); // ≥ 32 bytes
const rotated = createSigner(env.COOKIE_SECRET, {
  previousSecrets: [env.COOKIE_SECRET_OLD],
  hash: 'SHA-256', // default
});
```

### `signer.sign` / `signer.verify`

```ts
const signature = await signer.sign('hello'); // base64url HMAC
const ok = await signer.verify('hello', signature); // true
const bad = await signer.verify('hellp', signature); // false
```

### `signer.pack` / `signer.unpack`

`value.signature` for cookies and links whose content may be read but not changed.

```ts
const cookie = await signer.pack('user.42'); // "user.42.<sig>"
const userId = await signer.unpack(cookie); // "user.42" or undefined
```

## Encrypted values (`createSealer`)

Authenticated encryption (AES-256-GCM) for values the client holds but must not read or
change: encrypted cookies, OAuth state, password-reset payloads. Secret must be ≥ 32 bytes.

### `createSealer`

```ts
import { createSealer } from '@suku/crypto';

const sealer = createSealer(env.COOKIE_SECRET, {
  purpose: 'session', // binds ciphertext to a use (default 'suku.seal')
  previousSecrets: [env.COOKIE_SECRET_OLD],
});

const reset = createSealer(env.COOKIE_SECRET, { purpose: 'reset' });
// a value sealed as 'session' cannot be opened with 'reset'
```

### `sealer.seal` / `sealer.unseal`

```ts
const sealed = await sealer.seal({ id: 42, role: 'admin' }, { ttl: '1h' });
const session = await sealer.unseal<{ id: number; role: string }>(sealed);
// { id: 42, role: 'admin' } — or undefined if tampered, expired, or wrong key/purpose
```

## Random

### `randomToken`

URL-safe random token. 32 bytes (256 bits) by default — session ids, reset tokens, API keys.

```ts
import { randomToken } from '@suku/crypto';

const sessionId = randomToken(); // 32 bytes → base64url
const apiKey = randomToken(32);
const shortId = randomToken(16);
```

### `randomBytes`

Cryptographically secure random bytes (`Uint8Array`).

```ts
import { randomBytes } from '@suku/crypto';

const salt = randomBytes(16);
const iv = randomBytes(12);
```

### `randomHex`

Hex-encoded random bytes. 16 bytes by default.

```ts
import { randomHex } from '@suku/crypto';

const requestId = randomHex(); // 32 hex chars
const nonce = randomHex(8);
```

### `randomUUID`

```ts
import { randomUUID } from '@suku/crypto';

const id = randomUUID(); // "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### `randomInt`

Uniform integer in `[min, max)`, without modulo bias.

```ts
import { randomInt } from '@suku/crypto';

const dice = randomInt(1, 7); // 1..6
const index = randomInt(0, items.length);
```

## Hashing and compare

Not for passwords — use `hashPassword`.

### `sha256` / `sha512`

Hex digests for content fingerprints and cache keys.

```ts
import { sha256, sha512 } from '@suku/crypto';

const etag = await sha256(body);
const fingerprint = await sha512(fileBytes);
```

### `digest`

Raw digest bytes for a chosen algorithm.

```ts
import { digest } from '@suku/crypto';

const bytes = await digest('SHA-256', 'hello'); // Uint8Array
const wide = await digest('SHA-512', buffer);
```

### `timingSafeEqual`

Constant-time compare for secrets you check yourself (API keys, tokens). Signatures from
this package are already verified in constant time.

```ts
import { timingSafeEqual } from '@suku/crypto';

if (!timingSafeEqual(providedApiKey, storedApiKey)) {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
```

## JWT safety defaults

- The algorithm is fixed when you call `createJwt` and is never read from a token, so
  `alg: none` and RSA/HMAC key-confusion tokens are rejected.
- Tokens expire after one hour unless you set `expiresIn`; a token without `exp` is rejected
  unless you opt out with `expiresIn: false`.
- HMAC secrets shorter than the hash output (32 bytes for HS256) are refused.
- `exp`, `nbf`, future `iat`, the configured `issuer` and `audience` are all checked.
- Supported: HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512, EdDSA (Ed25519).
  Keys may be PEM (PKCS#8 private, SPKI public), JWK or `CryptoKey`.
- `previousSecrets` and `previousPublicKeys` allow rotation: old keys verify, never sign.

Not included: JWE (encrypted JWTs), JWKS fetching, and token revocation. Keep access tokens
short-lived and store refresh tokens server-side.

This package has not had an independent security audit.
