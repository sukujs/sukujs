export { type Duration, toSeconds } from './duration.js';
export {
  type Bytes,
  base64urlDecode,
  base64urlEncode,
  type Data,
  hexEncode,
  timingSafeEqual,
} from './encoding.js';
export { CryptoError, type CryptoErrorCode, JwtError } from './errors.js';
export { digest, type HashAlgorithm, sha256, sha512 } from './hash.js';
export {
  bearerToken,
  createJwt,
  decodeJwtUnverified,
  type HmacJwtOptions,
  type Jwt,
  type JwtAlgorithm,
  type JwtClaims,
  type JwtOptions,
  type JwtPayload,
  type KeyInput,
  type KeyPairJwtOptions,
  type SignOptions,
} from './jwt.js';
export {
  DEFAULT_PASSWORD_ITERATIONS,
  hashPassword,
  needsRehash,
  type PasswordOptions,
  verifyPassword,
} from './password.js';
export { randomBytes, randomHex, randomInt, randomToken, randomUUID } from './random.js';
export { createSealer, type Sealer, type SealerOptions } from './seal.js';
export { createSigner, type Signer, type SignerOptions } from './signer.js';

import { toSeconds } from './duration.js';
import { base64urlDecode, base64urlEncode, hexEncode, timingSafeEqual } from './encoding.js';
import { CryptoError, JwtError } from './errors.js';
import { digest, sha256, sha512 } from './hash.js';
import { bearerToken, createJwt, decodeJwtUnverified } from './jwt.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import { randomBytes, randomHex, randomInt, randomToken, randomUUID } from './random.js';
import { createSealer } from './seal.js';
import { createSigner } from './signer.js';

/**
 * Everything in one object, for `import sukuCrypto from '@suku/crypto'`.
 * The named exports are the same functions and tree-shake better.
 */
const sukuCrypto = {
  createJwt,
  bearerToken,
  decodeJwtUnverified,
  hashPassword,
  verifyPassword,
  needsRehash,
  createSigner,
  createSealer,
  randomToken,
  randomBytes,
  randomHex,
  randomUUID,
  randomInt,
  sha256,
  sha512,
  digest,
  timingSafeEqual,
  base64urlEncode,
  base64urlDecode,
  hexEncode,
  toSeconds,
  CryptoError,
  JwtError,
} as const;

export default sukuCrypto;
