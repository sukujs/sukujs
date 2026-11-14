export type CryptoErrorCode =
  | 'malformed'
  | 'invalid_signature'
  | 'expired'
  | 'not_active'
  | 'invalid_claim'
  | 'algorithm_mismatch'
  | 'weak_key'
  | 'invalid_key'
  | 'invalid_input';

/** Every failure in this package. Branch on `code`; do not show `message` to end users. */
export class CryptoError extends Error {
  override readonly name: string = 'CryptoError';
  constructor(
    readonly code: CryptoErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** A token that could not be created or must not be trusted. */
export class JwtError extends CryptoError {
  override readonly name = 'JwtError';
}
