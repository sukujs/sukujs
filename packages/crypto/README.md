# @sukujs/crypto

Zero-dependency crypto helpers on the Web Crypto API. Works on Node 22+, Bun and edge
runtimes, with or without the rest of Suku.

```ts
import sukuCrypto from '@sukujs/crypto';

const jwt = sukuCrypto.createJwt<{ role: string }>({
  secret: env.JWT_SECRET,
  issuer: 'api',
  expiresIn: '15m',
});
const token = await jwt.sign({ role: 'admin' }, { subject: user.id });
const payload = await jwt.verify(token); // throws JwtError if not trustworthy

const stored = await sukuCrypto.hashPassword(password);
await sukuCrypto.verifyPassword(password, stored); // true or false

const signed = await sukuCrypto.createSigner(env.COOKIE_SECRET).pack('user.42'); // readable, tamper-proof
const sealed = await sukuCrypto.createSealer(env.COOKIE_SECRET).seal({ id: 42 }); // encrypted
```

| Area                | API                                                                   | Use for                                                                              |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| JWT                 | `createJwt`, `bearerToken`, `decodeJwtUnverified`                     | API authentication, and tokens other services verify                                 |
| Passwords           | `hashPassword`, `verifyPassword`, `needsRehash`                       | Storing and checking user passwords                                                  |
| Signed values       | `createSigner` (HMAC): `sign`, `verify`, `pack`, `unpack`             | Values a client may read but not change: cookies, links, webhooks                    |
| Sealed values       | `createSealer` (AES-256-GCM): `seal`, `unseal`, with optional `ttl`   | Values a client holds but must not read: encrypted cookies, OAuth state, reset links |
| Encryption          | `createEncrypter` (AES-256-GCM or RSA-OAEP-256): `encrypt`, `decrypt` | Data you store: database fields, files, backups                                      |
| Random              | `randomToken`, `randomBytes`, `randomHex`, `randomUUID`, `randomInt`  | Session ids, API keys, reset tokens, nonces                                          |
| Hashing and compare | `sha256`, `sha512`, `digest`, `timingSafeEqual`                       | Fingerprints, cache keys, comparing secrets (not passwords)                          |

## JWT

### `createJwt`

Creates a signer/verifier bound to one algorithm and one set of keys. The algorithm is fixed
at creation time and never read from a token.

```ts
import sukuCrypto from '@sukujs/crypto';

// HMAC (default HS256) — secret must be at least 32 bytes for HS256
const jwt = sukuCrypto.createJwt<{ role: string }>({
  secret: env.JWT_SECRET, // or sukuCrypto.randomToken(32)
  issuer: 'api',
  audience: 'web',
  expiresIn: '15m', // default '1h'; use false for non-expiring tokens
});

// Asymmetric — sign with privateKey, verify with publicKey
const rsa = sukuCrypto.createJwt({
  algorithm: 'RS256',
  privateKey: process.env.JWT_PRIVATE_PEM, // PKCS#8 PEM
  publicKey: process.env.JWT_PUBLIC_PEM, // SPKI PEM
  issuer: 'api',
});

// Key rotation — old keys verify, never sign
const rotated = sukuCrypto.createJwt({
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
    jwtId: sukuCrypto.randomToken(16), // sets `jti`
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
import sukuCrypto from '@sukujs/crypto';

const token = sukuCrypto.bearerToken(request.headers.get('authorization'));
if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });

const payload = await jwt.verify(token);
```

### `decodeJwtUnverified`

Reads header and payload **without verifying anything**. Attacker-controlled — use only to
pick a key or to log; never to authorize.

```ts
import sukuCrypto from '@sukujs/crypto';

const { header, payload } = sukuCrypto.decodeJwtUnverified(token);
console.log(header.kid, payload.sub); // do not trust these for access control
```

## Passwords

PBKDF2-HMAC-SHA256 with 600,000 iterations and a 16-byte random salt, stored as
`$pbkdf2-sha256$i=600000$<salt>$<hash>`. It is the password KDF every Web Crypto runtime
has. If you can take a native dependency, Argon2id is stronger.

### `hashPassword`

```ts
import sukuCrypto from '@sukujs/crypto';

const stored = await sukuCrypto.hashPassword(password);
// "$pbkdf2-sha256$i=600000$…"

// Raise the work factor over time
const stronger = await sukuCrypto.hashPassword(password, { iterations: 800_000 });
```

### `verifyPassword`

Returns `true` only on a match. Malformed stored values return `false`, never throw.

```ts
import sukuCrypto from '@sukujs/crypto';

if (!(await sukuCrypto.verifyPassword(password, user.passwordHash))) {
  return Response.json({ error: 'invalid credentials' }, { status: 401 });
}
```

### `needsRehash`

`true` when the stored hash uses fewer iterations than you now want. Rehash after a
successful login.

```ts
import sukuCrypto from '@sukujs/crypto';

if (await sukuCrypto.verifyPassword(password, user.passwordHash)) {
  if (sukuCrypto.needsRehash(user.passwordHash, { iterations: 800_000 })) {
    user.passwordHash = await sukuCrypto.hashPassword(password, { iterations: 800_000 });
  }
}
```

## Signed values (`createSigner`)

HMAC for values that must not be tampered with: cookies, webhook payloads, unsubscribe
links. The value stays readable; use `createSealer` to hide it. Secret must be ≥ 32 bytes.

### `createSigner`

```ts
import sukuCrypto from '@sukujs/crypto';

const signer = sukuCrypto.createSigner(env.COOKIE_SECRET); // ≥ 32 bytes
const rotated = sukuCrypto.createSigner(env.COOKIE_SECRET, {
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

## Sealed values (`createSealer`)

Authenticated encryption (AES-256-GCM) for values the client holds but must not read or
change: encrypted cookies, OAuth state, password-reset payloads. Secret must be ≥ 32 bytes.

### `createSealer`

```ts
import sukuCrypto from '@sukujs/crypto';

const sealer = sukuCrypto.createSealer(env.COOKIE_SECRET, {
  purpose: 'session', // binds ciphertext to a use (default 'suku.seal')
  previousSecrets: [env.COOKIE_SECRET_OLD],
});

const reset = sukuCrypto.createSealer(env.COOKIE_SECRET, { purpose: 'reset' });
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
import sukuCrypto from '@sukujs/crypto';

const sessionId = sukuCrypto.randomToken(); // 32 bytes → base64url
const apiKey = sukuCrypto.randomToken(32);
const shortId = sukuCrypto.randomToken(16);
```

### `randomBytes`

Cryptographically secure random bytes (`Uint8Array`).

```ts
import sukuCrypto from '@sukujs/crypto';

const salt = sukuCrypto.randomBytes(16);
const iv = sukuCrypto.randomBytes(12);
```

### `randomHex`

Hex-encoded random bytes. 16 bytes by default.

```ts
import sukuCrypto from '@sukujs/crypto';

const requestId = sukuCrypto.randomHex(); // 32 hex chars
const nonce = sukuCrypto.randomHex(8);
```

### `randomUUID`

```ts
import sukuCrypto from '@sukujs/crypto';

const id = sukuCrypto.randomUUID(); // "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### `randomInt`

Uniform integer in `[min, max)`, without modulo bias.

```ts
import sukuCrypto from '@sukujs/crypto';

const dice = sukuCrypto.randomInt(1, 7); // 1..6
const index = sukuCrypto.randomInt(0, items.length);
```

## Encryption (`createEncrypter`)

For data you store: database fields, files, backups. For a value a client holds, such as a
cookie, use `createSealer`. Like `createJwt`, the algorithm is chosen once, when you create it.

| `algorithm`             | Encrypts with | Decrypts with     | Use when                                         |
| ----------------------- | ------------- | ----------------- | ------------------------------------------------ |
| `AES-256-GCM` (default) | `secret`      | the same `secret` | One service writes and reads the data            |
| `RSA-OAEP-256`          | `publicKey`   | `privateKey`      | The service that writes must not be able to read |

### `createEncrypter`

```ts
import sukuCrypto from '@sukujs/crypto';

// One secret (≥ 32 bytes). `purpose` gives each kind of data its own key.
const ssn = sukuCrypto.createEncrypter({
  secret: env.DATA_KEY,
  purpose: 'user.ssn',
  previousSecrets: [env.DATA_KEY_OLD], // decrypt only, for rotation
});

// A key pair: RSA-OAEP with SHA-256 wraps a random AES-256-GCM key per message.
const inbox = sukuCrypto.createEncrypter({
  algorithm: 'RSA-OAEP-256',
  publicKey: env.INBOX_PUBLIC_KEY, // to encrypt; PEM (SPKI), JWK or CryptoKey, 2048+ bits
  privateKey: env.INBOX_PRIVATE_KEY, // to decrypt; omit it where data is only written
});
```

### `encrypter.encrypt` / `encrypter.decrypt`

```ts
// Text: a URL-safe string for a database column.
const stored = await ssn.encrypt('123-45-6789', { context: user.id });
const plain = await ssn.decrypt(stored, { context: user.id }); // "123-45-6789"

// Files: raw bytes in and out, 29 bytes of overhead, no base64.
const sealed = await ssn.encrypt(fileBytes, { as: 'bytes' });
const original = await ssn.decrypt(sealed, { as: 'bytes' });
```

- `context` binds a value to the row it belongs to. It is not stored: pass the same value to
  `decrypt`, so a value copied into another row does not decrypt there.
- `decrypt` takes either form `encrypt` returned. It throws `CryptoError` with code
  `decryption_failed` if the data was changed, or encrypted with another key, purpose or
  context.

## Hashing and compare

Not for passwords — use `hashPassword`.

### `sha256` / `sha512`

Hex digests for content fingerprints and cache keys.

```ts
import sukuCrypto from '@sukujs/crypto';

const etag = await sukuCrypto.sha256(body);
const fingerprint = await sukuCrypto.sha512(fileBytes);
```

### `digest`

Raw digest bytes for a chosen algorithm.

```ts
import sukuCrypto from '@sukujs/crypto';

const bytes = await sukuCrypto.digest('SHA-256', 'hello'); // Uint8Array
const wide = await sukuCrypto.digest('SHA-512', buffer);
```

### `timingSafeEqual`

Constant-time compare for secrets you check yourself (API keys, tokens). Signatures from
this package are already verified in constant time.

```ts
import sukuCrypto from '@sukujs/crypto';

if (!sukuCrypto.timingSafeEqual(providedApiKey, storedApiKey)) {
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
