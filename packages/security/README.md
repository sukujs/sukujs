# @suku/security

Security middlewares for Suku: CORS, security headers, CSRF protection and rate limiting.

```ts
import sukuSecurity from '@suku/security';

const app = await Suku.create({
  features: [UsersFeature],
  middlewares: [
    sukuSecurity.securityHeaders(),
    sukuSecurity.cors({ origin: ['https://app.example.com'], credentials: true }),
    sukuSecurity.rateLimit({ limit: 300, window: '1m', trustProxy: 1 }),
    sukuSecurity.csrf(),
  ],
});
```

Named exports work too: `import { cors, rateLimit } from '@suku/security'`.

| Middleware                 | Notes                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `cors(options)`            | Origin lists, patterns or a function. Answers preflight itself, sets `Vary: Origin`, and refuses `*` with credentials at startup.    |
| `securityHeaders(options)` | HSTS, CSP, `nosniff`, frame, referrer and cross-origin policies. API-friendly defaults; headers a handler set are kept.              |
| `csrf(options)`            | Default `origin` mode checks `Sec-Fetch-Site` and `Origin`, with no token or storage. `token` mode is a signed double-submit cookie. |
| `rateLimit(options)`       | Fixed windows per client IP or any key, `RateLimit-*` and `Retry-After` headers, pluggable store.                                    |

Put `securityHeaders` and `cors` first so the responses of later middlewares, including a
`429` or `403`, carry their headers.

Behind a proxy, set `trustProxy` on `rateLimit`, or every user shares one counter. The
default store is in memory and is exact only for a single instance.

This package has not had an independent security audit.
