import { cors } from './cors.js';
import { csrf, csrfToken } from './csrf.js';
import { buildCsp, securityHeaders } from './headers.js';
import { clientIp, MemoryRateLimitStore, rateLimit } from './rate-limit.js';

export { type CorsOptions, cors } from './cors.js';
export {
  type CsrfOptions,
  type CsrfOriginOptions,
  type CsrfTokenOptions,
  csrf,
  csrfToken,
} from './csrf.js';
export {
  buildCsp,
  type CspDirectives,
  type SecurityHeadersOptions,
  securityHeaders,
} from './headers.js';
export {
  clientIp,
  MemoryRateLimitStore,
  type RateLimitHit,
  type RateLimitOptions,
  type RateLimitStore,
  rateLimit,
} from './rate-limit.js';
export type { Duration, OriginRule } from './util.js';

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
