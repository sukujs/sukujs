import { type Duration, toSeconds } from './duration.js';
import { type Bytes, base64urlDecode, base64urlEncode, toBytes, utf8 } from './encoding.js';
import { JwtError } from './errors.js';

export type JwtAlgorithm =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'EdDSA';

/** A PEM string (PKCS#8 private or SPKI public), a JWK, or an imported `CryptoKey`. */
export type KeyInput = string | JsonWebKey | CryptoKey;

/** Registered claims (RFC 7519). Your own claims sit alongside them. */
export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
}

export type JwtPayload<T = Record<string, unknown>> = T & JwtClaims;

/** Structural Standard Schema, so any schema library can validate payloads. */
interface PayloadSchema<T> {
  readonly '~standard': {
    readonly validate: (
      value: unknown,
    ) =>
      | { value: T; issues?: undefined }
      | { issues: readonly { message: string }[] }
      | Promise<{ value: T; issues?: undefined } | { issues: readonly { message: string }[] }>;
  };
}

interface CommonOptions<T> {
  /** Lifetime of signed tokens. Default `1h`. `false` issues tokens that never expire. */
  expiresIn?: Duration | false;
  /** Set as `iss` when signing and required when verifying. */
  issuer?: string;
  /** Set as `aud` when signing and required when verifying. */
  audience?: string | string[];
  /** Seconds of clock skew tolerated for `exp`, `nbf` and `iat`. Default 0. */
  clockTolerance?: number;
  /** Validates the payload on verify; its output type becomes the payload type. */
  schema?: PayloadSchema<T>;
  /** `kid` header for signed tokens. */
  keyId?: string;
  /** Largest token accepted, in characters. Default 8192. */
  maxTokenLength?: number;
  /** Clock in milliseconds. For tests. */
  now?: () => number;
}

export interface HmacJwtOptions<T> extends CommonOptions<T> {
  algorithm?: 'HS256' | 'HS384' | 'HS512';
  /** At least as long as the hash output: 32, 48 or 64 bytes for HS256, HS384, HS512. */
  secret: string | Uint8Array;
  /** Older secrets still accepted when verifying, for rotation. Never used to sign. */
  previousSecrets?: (string | Uint8Array)[];
}

export interface KeyPairJwtOptions<T> extends CommonOptions<T> {
  algorithm: Exclude<JwtAlgorithm, 'HS256' | 'HS384' | 'HS512'>;
  /** Needed to sign. Omit on services that only verify. */
  privateKey?: KeyInput;
  /** Needed to verify. */
  publicKey?: KeyInput;
  /** Older public keys still accepted when verifying, for rotation. */
  previousPublicKeys?: KeyInput[];
}

export type JwtOptions<T> = HmacJwtOptions<T> | KeyPairJwtOptions<T>;

export interface SignOptions {
  expiresIn?: Duration | false;
  /** Token is rejected until this much time has passed. */
  notBefore?: Duration;
  subject?: string;
  jwtId?: string;
}

export interface Jwt<T> {
  readonly algorithm: JwtAlgorithm;
  /** Signs a payload. Adds `iat`, `exp`, and the configured `iss` and `aud`. */
  sign(payload: T & JwtClaims, options?: SignOptions): Promise<string>;
  /**
   * Verifies the signature and claims and returns the payload. Throws `JwtError` otherwise;
   * a token that fails must be treated as absent.
   */
  verify(token: string): Promise<JwtPayload<T>>;
}

interface AlgorithmSpec {
  import: object;
  sign: object;
  /** Bytes of hash output, which is also the minimum HMAC key length. */
  size: number;
}

function spec(algorithm: JwtAlgorithm): AlgorithmSpec {
  const bits = algorithm.slice(2);
  const hash = `SHA-${bits}`;
  const size = Number(bits) / 8;
  switch (algorithm.slice(0, 2)) {
    case 'HS':
      return { import: { name: 'HMAC', hash }, sign: { name: 'HMAC' }, size };
    case 'RS':
      return {
        import: { name: 'RSASSA-PKCS1-v1_5', hash },
        sign: { name: 'RSASSA-PKCS1-v1_5' },
        size,
      };
    case 'PS':
      return {
        import: { name: 'RSA-PSS', hash },
        sign: { name: 'RSA-PSS', saltLength: size },
        size,
      };
    case 'ES': {
      const namedCurve = bits === '512' ? 'P-521' : `P-${bits}`;
      return { import: { name: 'ECDSA', namedCurve }, sign: { name: 'ECDSA', hash }, size };
    }
    default:
      return { import: { name: 'Ed25519' }, sign: { name: 'Ed25519' }, size: 0 };
  }
}

const ALGORITHMS: readonly string[] = [
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
];

function pemBody(pem: string, label: string): Bytes | undefined {
  const match = new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`).exec(pem);
  if (!match) return undefined;
  const binary = atob(match[1]!.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out as Bytes;
}

async function importKey(
  input: KeyInput,
  algorithm: JwtAlgorithm,
  usage: 'sign' | 'verify',
): Promise<CryptoKey> {
  const params = spec(algorithm).import as AlgorithmIdentifier;
  try {
    if (typeof input === 'string') {
      const label = usage === 'sign' ? 'PRIVATE KEY' : 'PUBLIC KEY';
      const der = pemBody(input, label);
      if (!der) {
        throw new JwtError(
          'invalid_key',
          `Expected a PEM "${label}" block (${usage === 'sign' ? 'PKCS#8' : 'SPKI'}). ` +
            'Convert legacy "RSA PRIVATE KEY" / "EC PRIVATE KEY" files with: openssl pkcs8 -topk8 -nocrypt.',
        );
      }
      return await crypto.subtle.importKey(
        usage === 'sign' ? 'pkcs8' : 'spki',
        der,
        params,
        false,
        [usage],
      );
    }
    if (typeof CryptoKey !== 'undefined' && input instanceof CryptoKey) {
      if (!input.usages.includes(usage))
        throw new JwtError('invalid_key', `CryptoKey does not allow "${usage}".`);
      return input;
    }
    return await crypto.subtle.importKey('jwk', input as JsonWebKey, params, false, [usage]);
  } catch (cause) {
    if (cause instanceof JwtError) throw cause;
    throw new JwtError('invalid_key', `Could not import the ${usage} key for ${algorithm}.`, {
      cause,
    });
  }
}

function importSecret(secret: string | Uint8Array, algorithm: JwtAlgorithm): Promise<CryptoKey> {
  const bytes = toBytes(secret);
  const { size, import: params } = spec(algorithm);
  if (bytes.byteLength < size) {
    throw new JwtError(
      'weak_key',
      `${algorithm} needs a secret of at least ${size} bytes; got ${bytes.byteLength}. Generate one with randomToken(${size}).`,
    );
  }
  return crypto.subtle.importKey('raw', bytes, params as AlgorithmIdentifier, false, [
    'sign',
    'verify',
  ]);
}

function parseJson(segment: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(utf8(base64urlDecode(segment)));
  } catch (cause) {
    throw new JwtError('malformed', `Token ${what} is not valid.`, { cause });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new JwtError('malformed', `Token ${what} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function numeric(claims: Record<string, unknown>, name: string): number | undefined {
  const v = claims[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new JwtError('invalid_claim', `Claim "${name}" must be a number.`);
  return v;
}

/**
 * Creates a signer and verifier bound to one algorithm and one set of keys.
 *
 * The algorithm is fixed here and never taken from a token, which rules out `alg: none` and
 * key-confusion attacks. Verification checks the signature, `exp`, `nbf`, `iat`, and the
 * configured issuer and audience.
 *
 * ```ts
 * const jwt = createJwt<{ role: string }>({ secret: env.JWT_SECRET, issuer: 'api', expiresIn: '15m' });
 * const token = await jwt.sign({ sub: user.id, role: 'admin' });
 * const payload = await jwt.verify(token);
 * ```
 */
export function createJwt<T = Record<string, unknown>>(options: JwtOptions<T>): Jwt<T> {
  const algorithm: JwtAlgorithm = options.algorithm ?? 'HS256';
  if (!ALGORITHMS.includes(algorithm))
    throw new JwtError('algorithm_mismatch', `Unsupported algorithm "${algorithm}".`);
  const hmac = algorithm.startsWith('HS');
  const params = spec(algorithm).sign as AlgorithmIdentifier;
  const tolerance = options.clockTolerance ?? 0;
  const maxLength = options.maxTokenLength ?? 8192;
  const now = () => Math.floor((options.now?.() ?? Date.now()) / 1000);
  const defaultExpiry = options.expiresIn === undefined ? '1h' : options.expiresIn;

  let signKey: Promise<CryptoKey> | undefined;
  let verifyKeys: Promise<CryptoKey[]> | undefined;

  const getSignKey = (): Promise<CryptoKey> => {
    if (signKey) return signKey;
    if (hmac) {
      if (!('secret' in options) || options.secret === undefined)
        throw new JwtError('invalid_key', `${algorithm} needs a secret.`);
      signKey = importSecret(options.secret, algorithm);
    } else {
      const key = (options as KeyPairJwtOptions<T>).privateKey;
      if (!key) throw new JwtError('invalid_key', `Signing with ${algorithm} needs a privateKey.`);
      signKey = importKey(key, algorithm, 'sign');
    }
    return signKey;
  };

  const getVerifyKeys = (): Promise<CryptoKey[]> => {
    if (verifyKeys) return verifyKeys;
    if (hmac) {
      const o = options as HmacJwtOptions<T>;
      if (o.secret === undefined) throw new JwtError('invalid_key', `${algorithm} needs a secret.`);
      verifyKeys = Promise.all(
        [o.secret, ...(o.previousSecrets ?? [])].map((s) => importSecret(s, algorithm)),
      );
    } else {
      const o = options as KeyPairJwtOptions<T>;
      if (!o.publicKey)
        throw new JwtError('invalid_key', `Verifying ${algorithm} needs a publicKey.`);
      verifyKeys = Promise.all(
        [o.publicKey, ...(o.previousPublicKeys ?? [])].map((k) =>
          importKey(k, algorithm, 'verify'),
        ),
      );
    }
    return verifyKeys;
  };

  async function sign(payload: T & JwtClaims, signOptions: SignOptions = {}): Promise<string> {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new JwtError('invalid_input', 'JWT payload must be a plain object.');
    }
    const issuedAt = now();
    const claims: Record<string, unknown> = { ...payload, iat: issuedAt };
    const expiry = signOptions.expiresIn === undefined ? defaultExpiry : signOptions.expiresIn;
    if (expiry !== false) claims.exp = issuedAt + toSeconds(expiry);
    if (signOptions.notBefore !== undefined)
      claims.nbf = issuedAt + toSeconds(signOptions.notBefore);
    if (options.issuer !== undefined) claims.iss = options.issuer;
    if (options.audience !== undefined) claims.aud = options.audience;
    if (signOptions.subject !== undefined) claims.sub = signOptions.subject;
    if (signOptions.jwtId !== undefined) claims.jti = signOptions.jwtId;

    const header: Record<string, string> = { alg: algorithm, typ: 'JWT' };
    if (options.keyId !== undefined) header.kid = options.keyId;
    const signingInput = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(JSON.stringify(claims))}`;
    const signature = await crypto.subtle.sign(params, await getSignKey(), toBytes(signingInput));
    return `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`;
  }

  async function verify(token: string): Promise<JwtPayload<T>> {
    if (typeof token !== 'string' || token.length === 0)
      throw new JwtError('malformed', 'Token is missing.');
    if (token.length > maxLength) throw new JwtError('malformed', 'Token is too long.');
    const parts = token.split('.');
    if (parts.length !== 3) throw new JwtError('malformed', 'Token must have three parts.');
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

    const header = parseJson(headerPart, 'header');
    // The algorithm comes from configuration. A token naming any other one, including
    // "none", is rejected before any key is touched.
    if (header.alg !== algorithm) {
      throw new JwtError('algorithm_mismatch', `Token algorithm is not ${algorithm}.`);
    }
    if (header.crit !== undefined)
      throw new JwtError('malformed', 'Token uses unsupported critical headers.');
    if (header.typ !== undefined && String(header.typ).toUpperCase() !== 'JWT') {
      throw new JwtError('malformed', 'Token type is not JWT.');
    }

    const signature = base64urlDecode(signaturePart);
    const data = toBytes(`${headerPart}.${payloadPart}`);
    let valid = false;
    for (const key of await getVerifyKeys()) {
      if (await crypto.subtle.verify(params, key, signature, data)) {
        valid = true;
        break;
      }
    }
    if (!valid) throw new JwtError('invalid_signature', 'Token signature is not valid.');

    const claims = parseJson(payloadPart, 'payload');
    const at = now();
    const exp = numeric(claims, 'exp');
    const nbf = numeric(claims, 'nbf');
    const iat = numeric(claims, 'iat');
    if (exp === undefined) {
      if (defaultExpiry !== false) throw new JwtError('invalid_claim', 'Token has no expiry.');
    } else if (at >= exp + tolerance) {
      throw new JwtError('expired', 'Token has expired.');
    }
    if (nbf !== undefined && at < nbf - tolerance)
      throw new JwtError('not_active', 'Token is not active yet.');
    if (iat !== undefined && iat > at + tolerance)
      throw new JwtError('invalid_claim', 'Token was issued in the future.');
    if (options.issuer !== undefined && claims.iss !== options.issuer) {
      throw new JwtError('invalid_claim', 'Token issuer does not match.');
    }
    if (options.audience !== undefined) {
      const expected = Array.isArray(options.audience) ? options.audience : [options.audience];
      const actual = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!actual.some((a) => typeof a === 'string' && expected.includes(a))) {
        throw new JwtError('invalid_claim', 'Token audience does not match.');
      }
    }

    if (options.schema) {
      const result = await options.schema['~standard'].validate(claims);
      if (result.issues) {
        throw new JwtError(
          'invalid_claim',
          `Token payload is not valid: ${result.issues.map((i) => i.message).join('; ')}`,
        );
      }
      return { ...claims, ...(result.value as object) } as JwtPayload<T>;
    }
    return claims as JwtPayload<T>;
  }

  return { algorithm, sign, verify };
}

/**
 * Reads a token's header and payload **without verifying anything**. The result is
 * attacker-controlled. Use only to pick a key or to log; never to make a decision.
 */
export function decodeJwtUnverified(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new JwtError('malformed', 'Token must have three parts.');
  return { header: parseJson(parts[0]!, 'header'), payload: parseJson(parts[1]!, 'payload') };
}

/** Extracts the token from an `Authorization: Bearer <token>` header value. */
export function bearerToken(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(header.trim());
  return match?.[1];
}
