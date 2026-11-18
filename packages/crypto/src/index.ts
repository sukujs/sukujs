export { type Duration, toSeconds } from './duration';
export {
  type Bytes,
  base64urlDecode,
  base64urlEncode,
  type Data,
  hexEncode,
  timingSafeEqual,
} from './encoding';
export {
  createEncrypter,
  type EncryptionAlgorithm,
  type EncryptOptions,
  type Encrypter,
  type EncrypterOptions,
  type KeyPairEncrypterOptions,
  type SecretEncrypterOptions,
} from './encrypt';
export { CryptoError, type CryptoErrorCode, JwtError } from './errors';
export { digest, type HashAlgorithm, sha256, sha512 } from './hash';
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
} from './jwt';
export {
  DEFAULT_PASSWORD_ITERATIONS,
  hashPassword,
  needsRehash,
  type PasswordOptions,
  verifyPassword,
} from './password';
export { randomBytes, randomHex, randomInt, randomToken, randomUUID } from './random';
export { createSealer, type Sealer, type SealerOptions } from './seal';
export { createSigner, type Signer, type SignerOptions } from './signer';

import { toSeconds } from './duration';
import { base64urlDecode, base64urlEncode, hexEncode, timingSafeEqual } from './encoding';
import { createEncrypter } from './encrypt';
import { CryptoError, JwtError } from './errors';
import { digest, sha256, sha512 } from './hash';
import { bearerToken, createJwt, decodeJwtUnverified } from './jwt';
import { hashPassword, needsRehash, verifyPassword } from './password';
import { randomBytes, randomHex, randomInt, randomToken, randomUUID } from './random';
import { createSealer } from './seal';
import { createSigner } from './signer';

/**
 * Everything in one object, for `import sukuCrypto from '@sukujs/crypto'`.
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
  createEncrypter,
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
