// One API, deployed everywhere. Each route exists to check one thing about a deployment.
import {
  defineConfig,
  feature,
  type Infer,
  InjectionToken,
  type PlatformAdapter,
  Routes,
  route,
  Suku,
  singleton,
  value,
} from '@sukujs/core';
import { hashPassword, verifyPassword } from '@sukujs/crypto';
import { clientIp, rateLimit, securityHeaders } from '@sukujs/security';
import { z } from 'zod';

export const Env = defineConfig(
  'env',
  z.object({
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    /** Number of proxies in front of the app. 0 when clients connect directly. */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    GREETING: z.string().min(1).default('Hello'),
    APP_VERSION: z.string().default('dev'),
  }),
);
type Env = Infer<typeof Env.schema>;

/** Where this copy is running: "node", "bun", "cloudflare-workers", "vercel". */
export const RUNTIME = new InjectionToken<string>('runtime');

/** One per process. Different ids across requests mean several copies are serving you. */
export class Instance {
  static inject = [Env, RUNTIME];

  readonly id = crypto.randomUUID().slice(0, 8);
  readonly startedAt = Date.now();

  constructor(
    private readonly env: Env,
    private readonly runtime: string,
  ) {}

  describe() {
    return {
      runtime: this.runtime,
      version: this.env.APP_VERSION,
      instance: this.id,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }
}

/** A class with constructor injection, to prove it survives each platform's build. */
@Routes()
export class SystemRoutes {
  static inject = [Instance];

  constructor(private readonly instance: Instance) {}

  /** Liveness: the process answers. */
  health = route.get('/health', { handle: () => ({ status: 'ok' }) });

  /** Readiness: this is where a database ping would go. */
  ready = route.get('/ready', { handle: () => ({ status: 'ready' }) });

  info = route.get('/info', { handle: () => this.instance.describe() });
}

/** Configuration reached the app. */
const hello = route.get('/hello/:name', {
  services: { env: Env },
  handle: ({ params, env }) => ({ message: `${env.GREETING}, ${params.name}` }),
});

/** What the app sees of the client. Behind a proxy, `ip` is right only with TRUST_PROXY. */
const whoami = route.get('/whoami', {
  services: { env: Env },
  handle: ({ ctx, env }) => ({
    ip: clientIp(ctx, env.TRUST_PROXY) ?? null,
    peer: ctx.remoteAddress ?? null,
    host: ctx.url.host,
    protocol: ctx.url.protocol.replace(':', ''),
    forwardedFor: ctx.headers.get('x-forwarded-for'),
    forwardedProto: ctx.headers.get('x-forwarded-proto'),
  }),
});

/** Request bodies arrive intact and are validated. */
const echo = route.post('/echo', {
  status: 200,
  body: z.object({ message: z.string().min(1).max(200) }),
  handle: ({ body }) => ({ echo: body.message, length: body.message.length }),
});

/** Five requests a minute per client. With several copies, each keeps its own count. */
const limited = route.get('/limited', {
  middlewares: [
    rateLimit({
      limit: 5,
      window: '1m',
      key: (ctx) => clientIp(ctx, ctx.provider.get(Env).TRUST_PROXY) ?? 'unknown',
    }),
  ],
  handle: () => ({ ok: true }),
});

/** Holds a request open, to watch a graceful shutdown let it finish. */
const slow = route.get('/slow', {
  query: z.object({ ms: z.coerce.number().int().min(0).max(30_000).default(5000) }),
  handle: async ({ query }) => {
    await new Promise((resolve) => setTimeout(resolve, query.ms));
    return { waitedMs: query.ms };
  },
});

/** CPU-heavy on purpose, to find a platform's CPU limit. */
const hash = route.post('/hash', {
  status: 200,
  body: z.object({ password: z.string().min(1).max(200) }),
  handle: async ({ body }) => {
    const started = Date.now();
    const hashed = await hashPassword(body.password);
    return { verified: await verifyPassword(body.password, hashed), ms: Date.now() - started };
  },
});

export const AppFeature = feature('app', {
  routes: [SystemRoutes, hello, whoami, echo, limited, slow, hash],
  services: [singleton(Instance)],
});

export interface CreateAppOptions {
  runtime: string;
  /** Where configuration comes from. Default: the process environment. */
  source?: Record<string, unknown>;
  /** Needed only where the app listens on a port. */
  adapter?: PlatformAdapter;
}

export const createApp = ({ runtime, source, adapter }: CreateAppOptions) =>
  Suku.create({
    features: [source ? Env.load(source) : Env.load(), AppFeature],
    services: [value(RUNTIME, runtime)],
    middlewares: [securityHeaders()],
    ...(adapter ? { adapter } : {}),
  });
