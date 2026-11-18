import { cors } from './cors';
import { csrf, csrfToken } from './csrf';
import { buildCsp, securityHeaders } from './headers';
import { clientIp, MemoryRateLimitStore, rateLimit } from './rate-limit';

export { type CorsOptions, cors } from './cors';
export {
  type CsrfOptions,
  type CsrfOriginOptions,
  type CsrfTokenOptions,
  csrf,
  csrfToken,
} from './csrf';
export {
  buildCsp,
  type CspDirectives,
  type SecurityHeadersOptions,
  securityHeaders,
} from './headers';
export {
  clientIp,
  MemoryRateLimitStore,
  type RateLimitHit,
  type RateLimitOptions,
  type RateLimitStore,
  rateLimit,
} from './rate-limit';
export type { Duration, OriginRule } from './util';

/**
 * Everything in one object, for `import sukuSecurity from '@sukujs/security'`.
 * The named exports are the same functions.
 */
const sukuSecurity = {
  cors,
  securityHeaders,
  buildCsp,
  csrf,
  csrfToken,
  rateLimit,
  clientIp,
  MemoryRateLimitStore,
} as const;

export default sukuSecurity;
