import { describe, expect, test } from 'bun:test';
import { route, Suku, UnauthorizedException } from '@sukujs/core';
import sukuSecurity, {
  buildCsp,
  clientIp,
  cors,
  csrf,
  csrfToken,
  MemoryRateLimitStore,
  rateLimit,
  securityHeaders,
} from '../src/index.js';

const req = (path: string, init?: RequestInit) => new Request(`http://api.test${path}`, init);
const routes = [
  route.get('/data', { handle: () => ({ ok: true }) }),
  route.post('/data', { handle: () => ({ saved: true }) }),
  route.get('/private', {
    middlewares: [
      () => {
        throw new UnauthorizedException();
      },
    ],
    handle: () => 'x',
  }),
  route.get('/framed', {
    handle: () => new Response('<p>hi</p>', { headers: { 'x-frame-options': 'SAMEORIGIN' } }),
  }),
  route.get('/redirect', { handle: () => Response.redirect('http://api.test/data', 302) }),
];
const create = (middlewares: import('@sukujs/core').MiddlewareRef[]) =>
  Suku.create({ routes, middlewares });

describe('cors', () => {
  test('wildcard: any origin, no Vary, no headers without an Origin', async () => {
    const app = await create([cors()]);
    const res = await app.handle(req('/data', { headers: { origin: 'https://a.example' } }));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('vary')).toBeNull();
    expect((await app.handle(req('/data'))).headers.get('access-control-allow-origin')).toBeNull();
  });

  test('allow-list: echoes allowed origins, sets Vary, gives nothing to others', async () => {
    const app = await create([
      cors({
        origin: ['https://app.example', /^https:\/\/.+\.preview\.example$/],
        credentials: true,
        exposedHeaders: ['x-total'],
      }),
    ]);
    const ok = await app.handle(req('/data', { headers: { origin: 'https://app.example' } }));
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    expect(ok.headers.get('access-control-expose-headers')).toBe('x-total');
    expect(ok.headers.get('vary')).toBe('Origin');
    const preview = await app.handle(
      req('/data', { headers: { origin: 'https://pr-12.preview.example' } }),
    );
    expect(preview.headers.get('access-control-allow-origin')).toBe(
      'https://pr-12.preview.example',
    );
    const evil = await app.handle(req('/data', { headers: { origin: 'https://evil.example' } }));
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    expect(evil.headers.get('vary')).toBe('Origin');
    expect(evil.status).toBe(200);
  });

  test('preflight is answered without reaching a route', async () => {
    const app = await create([cors({ origin: 'https://app.example', maxAge: 60 })]);
    const pre = (origin: string) =>
      app.handle(
        req('/data', {
          method: 'OPTIONS',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type, x-token',
          },
        }),
      );
    const ok = await pre('https://app.example');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(ok.headers.get('access-control-allow-methods')).toBe(
      'GET, HEAD, PUT, PATCH, POST, DELETE',
    );
    expect(ok.headers.get('access-control-allow-headers')).toBe('content-type, x-token');
    expect(ok.headers.get('access-control-max-age')).toBe('60');
    expect(ok.headers.get('vary')).toBe('Origin, Access-Control-Request-Headers');
    const bad = await pre('https://evil.example');
    expect(bad.status).toBe(204);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    // A plain OPTIONS without the preflight header is not a preflight.
    expect((await app.handle(req('/data', { method: 'OPTIONS' }))).status).not.toBe(204);
  });

  test('errors, 404s and inner-middleware rejections keep their CORS headers', async () => {
    const app = await create([cors({ origin: 'https://app.example' })]);
    const h = { headers: { origin: 'https://app.example' } };
    for (const [path, status] of [
      ['/nope', 404],
      ['/private', 401],
    ] as const) {
      const res = await app.handle(req(path, h));
      expect(res.status).toBe(status);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
    }
    const redirect = await app.handle(req('/redirect', h)); // immutable headers are copied
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('access-control-allow-origin')).toBe('https://app.example');
  });

  test('function origins; wildcard with credentials is refused at startup', async () => {
    const app = await create([cors({ origin: (o) => o.endsWith('.trusted.example') })]);
    expect(
      (
        await app.handle(req('/data', { headers: { origin: 'https://x.trusted.example' } }))
      ).headers.get('access-control-allow-origin'),
    ).toBe('https://x.trusted.example');
    expect(
      (
        await app.handle(req('/data', { headers: { origin: 'https://x.other.example' } }))
      ).headers.get('access-control-allow-origin'),
    ).toBeNull();
    expect(() => cors({ credentials: true })).toThrow(/cannot be combined/);
  });
});

describe('securityHeaders', () => {
  test('defaults suit an API and apply to errors too', async () => {
    const app = await create([securityHeaders()]);
    for (const path of ['/data', '/nope']) {
      const h = (await app.handle(req(path))).headers;
      expect(h.get('strict-transport-security')).toBe('max-age=15552000; includeSubDomains');
      expect(h.get('content-security-policy')).toBe(
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      expect(h.get('x-content-type-options')).toBe('nosniff');
      expect(h.get('x-frame-options')).toBe('DENY');
      expect(h.get('referrer-policy')).toBe('no-referrer');
      expect(h.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(h.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(h.get('permissions-policy')).toBeNull();
    }
  });

  test('a header the handler set is kept; options override, disable and add', async () => {
    const app = await create([
      securityHeaders({
        hsts: { maxAge: 60, includeSubDomains: false, preload: true },
        contentSecurityPolicy: { 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'] },
        referrerPolicy: false,
        crossOriginResourcePolicy: 'cross-origin',
        permissionsPolicy: 'camera=()',
        extra: { 'X-Custom': '1' },
      }),
    ]);
    const framed = await app.handle(req('/framed'));
    expect(framed.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    const h = (await app.handle(req('/data'))).headers;
    expect(h.get('strict-transport-security')).toBe('max-age=60; preload');
    expect(h.get('content-security-policy')).toBe("default-src 'self'; img-src 'self' data:");
    expect(h.get('referrer-policy')).toBeNull();
    expect(h.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(h.get('permissions-policy')).toBe('camera=()');
    expect(h.get('x-custom')).toBe('1');
    expect(buildCsp({ 'upgrade-insecure-requests': '' })).toBe('upgrade-insecure-requests');
    const none = await create([
      securityHeaders({
        hsts: false,
        contentSecurityPolicy: false,
        frameOptions: false,
        noSniff: false,
        crossOriginOpenerPolicy: false,
        crossOriginResourcePolicy: false,
        referrerPolicy: false,
      }),
    ]);
    expect([...(await none.handle(req('/data'))).headers.keys()]).toEqual(['content-type']);
  });
});

describe('csrf, origin mode', () => {
  const post = (headers: Record<string, string>) => req('/data', { method: 'POST', headers });

  test('safe methods and non-browser clients pass', async () => {
    const app = await create([csrf()]);
    expect(
      (
        await app.handle(
          req('/data', {
            headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await app.handle(post({}))).status).toBe(201);
  });

  test('cross-site state-changing requests are blocked, same-origin ones pass', async () => {
    const app = await create([csrf()]);
    expect((await app.handle(post({ 'sec-fetch-site': 'same-origin' }))).status).toBe(201);
    expect((await app.handle(post({ 'sec-fetch-site': 'none' }))).status).toBe(201);
    expect((await app.handle(post({ origin: 'http://api.test' }))).status).toBe(201);
    expect((await app.handle(post({ origin: 'https://api.test' }))).status).toBe(201); // TLS terminated upstream
    const blocked = await app.handle(
      post({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
    );
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { message: string }).message).toBe(
      'Cross-site request blocked',
    );
    expect((await app.handle(post({ origin: 'https://evil.example' }))).status).toBe(403);
    expect((await app.handle(post({ 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await app.handle(post({ 'sec-fetch-site': 'same-site' }))).status).toBe(403);
    expect(
      (await app.handle(post({ origin: 'http://api.test', 'sec-fetch-site': 'cross-site' })))
        .status,
    ).toBe(403);
    expect((await app.handle(post({ origin: 'null' }))).status).toBe(403);
  });

  test('allowedOrigins and skip', async () => {
    const app = await create([
      csrf({
        allowedOrigins: ['https://app.example'],
        skip: (ctx) => ctx.headers.has('x-webhook'),
      }),
    ]);
    expect(
      (await app.handle(post({ origin: 'https://app.example', 'sec-fetch-site': 'cross-site' })))
        .status,
    ).toBe(201);
    expect(
      (await app.handle(post({ origin: 'https://other.example', 'sec-fetch-site': 'cross-site' })))
        .status,
    ).toBe(403);
    expect(
      (await app.handle(post({ origin: 'https://other.example', 'x-webhook': '1' }))).status,
    ).toBe(201);
  });
});

describe('csrf, token mode', () => {
  const secret = 'a-secret-that-is-at-least-32-characters';

  test('issues a signed cookie, then requires it echoed in a header', async () => {
    const app = await Suku.create({
      routes: [
        ...routes,
        route.get('/token', { handle: ({ ctx }) => ({ token: csrfToken(ctx) }) }),
      ],
      middlewares: [csrf({ mode: 'token', secret })],
    });
    const first = await app.handle(req('/token'));
    const cookie = first.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^csrf=[A-Za-z0-9_.-]+; Path=\/; SameSite=Lax; Secure$/);
    const token = cookie.slice(5, cookie.indexOf(';'));
    expect(((await first.json()) as { token: string }).token).toBe(token);

    const post = (headers: Record<string, string>) =>
      app.handle(req('/data', { method: 'POST', headers }));
    expect((await post({ cookie: `csrf=${token}`, 'x-csrf-token': token })).status).toBe(201);
    expect((await post({ cookie: `other=1; csrf=${token}`, 'x-csrf-token': token })).status).toBe(
      201,
    );
    expect((await post({ cookie: `csrf=${token}` })).status).toBe(403);
    expect((await post({ 'x-csrf-token': token })).status).toBe(403);
    expect((await post({ cookie: `csrf=${token}`, 'x-csrf-token': `${token}x` })).status).toBe(403);
    // A cookie an attacker planted is not signed by us, even if the header matches it.
    expect(
      (await post({ cookie: 'csrf=forged.value', 'x-csrf-token': 'forged.value' })).status,
    ).toBe(403);
    // A valid cookie is not reissued.
    expect(
      (await app.handle(req('/data', { headers: { cookie: `csrf=${token}` } }))).headers.get(
        'set-cookie',
      ),
    ).toBeNull();
  });

  test('a short secret is refused at startup', () => {
    expect(() => csrf({ mode: 'token', secret: 'short' })).toThrow(/at least 32/);
  });
});

describe('rateLimit', () => {
  test('counts per client, answers 429 with headers, and resets after the window', async () => {
    let clock = 1_000_000;
    const app = await create([rateLimit({ limit: 2, window: '1m', now: () => clock })]);
    const hit = (ip: string) => app.handle(req('/data'), { remoteAddress: ip });
    const a1 = await hit('1.1.1.1');
    expect(a1.status).toBe(200);
    expect([
      a1.headers.get('ratelimit-limit'),
      a1.headers.get('ratelimit-remaining'),
      a1.headers.get('ratelimit-reset'),
    ]).toEqual(['2', '1', '60']);
    expect((await hit('1.1.1.1')).headers.get('ratelimit-remaining')).toBe('0');
    clock += 20_000;
    const limited = await hit('1.1.1.1');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('40');
    expect(await limited.json()).toEqual({
      statusCode: 429,
      message: 'Too many requests, please try again later',
      error: 'Too Many Requests',
    });
    expect((await hit('2.2.2.2')).status).toBe(200); // another client is unaffected
    clock += 40_000;
    expect((await hit('1.1.1.1')).status).toBe(200);
  });

  test('custom key, skip, uncounted undefined key, shared store with names, no headers', async () => {
    const store = new MemoryRateLimitStore();
    const perUser = rateLimit({
      limit: 1,
      window: 60,
      store,
      name: 'user',
      headers: false,
      key: (ctx) => ctx.headers.get('x-user') ?? undefined,
      skip: (ctx) => ctx.url.pathname === '/framed',
    });
    const other = rateLimit({ limit: 1, window: 60, store, name: 'other', key: () => 'k' });
    const app = await create([perUser, other]);
    const call = (path: string, user?: string) =>
      app.handle(req(path, user ? { headers: { 'x-user': user } } : {}));
    const first = await call('/data', 'u1');
    expect(first.status).toBe(200);
    expect(store.size).toBe(2);
    expect((await call('/data', 'u1')).status).toBe(429);
    const solo = await Suku.create({
      routes,
      middlewares: [
        rateLimit({
          limit: 1,
          window: 60,
          headers: false,
          key: (ctx) => ctx.headers.get('x-user') ?? undefined,
        }),
      ],
    });
    expect((await solo.handle(req('/data'))).status).toBe(200);
    expect((await solo.handle(req('/data'))).status).toBe(200); // no key: uncounted
    const r = await solo.handle(req('/data', { headers: { 'x-user': 'a' } }));
    expect(r.headers.get('ratelimit-limit')).toBeNull();
    expect(() => rateLimit({ limit: 0, window: 60 })).toThrow(TypeError);
    expect(() => rateLimit({ limit: 1, window: 'soon' as never })).toThrow(TypeError);
  });

  test('per-route limiter and bounded memory', async () => {
    const app = await Suku.create({
      routes: [
        route.post('/login', {
          middlewares: [rateLimit({ limit: 1, window: '1m' })],
          handle: () => 'ok',
        }),
        route.get('/open', { handle: () => 'ok' }),
      ],
    });
    const login = () => app.handle(req('/login', { method: 'POST' }), { remoteAddress: '9.9.9.9' });
    expect((await login()).status).toBe(201);
    expect((await login()).status).toBe(429);
    expect((await app.handle(req('/open'), { remoteAddress: '9.9.9.9' })).status).toBe(200);
    const small = new MemoryRateLimitStore(50);
    for (let i = 0; i < 2000; i++) small.hit(`k${i}`, 60_000, 0);
    expect(small.size).toBeLessThanOrEqual(1050);
  });

  test('clientIp: socket address by default, X-Forwarded-For only when a proxy is trusted', async () => {
    const out: (string | undefined)[] = [];
    const app = await Suku.create({
      routes: [
        route.get('/ip', {
          handle: ({ ctx }) => {
            out.push(clientIp(ctx), clientIp(ctx, true), clientIp(ctx, 2), clientIp(ctx, 9));
            return 'ok';
          },
        }),
      ],
    });
    await app.handle(
      req('/ip', { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 10.0.0.2' } }),
      { remoteAddress: '10.0.0.1' },
    );
    // spoofable entry first, real client next, inner proxy, then the socket peer
    expect(out).toEqual(['10.0.0.1', '10.0.0.2', '203.0.113.7', '6.6.6.6']);
  });
});

test('default export carries the same functions', () => {
  expect(sukuSecurity.cors).toBe(cors);
  expect(sukuSecurity.rateLimit).toBe(rateLimit);
  expect(sukuSecurity.csrf).toBe(csrf);
  expect(sukuSecurity.securityHeaders).toBe(securityHeaders);
});
