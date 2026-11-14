import type { Infer, Middleware, Next } from '@sukujs/core';
import { Inject, Logger, RequestContext, Service, UnauthorizedException } from '@sukujs/core';
import { Env } from './config.js';

/** App-level middleware: one log line per request with status and duration. */
@Service()
export class RequestLogger implements Middleware {
  constructor(private readonly log: Logger) {}

  async use(ctx: RequestContext, next: Next): Promise<Response> {
    const started = performance.now();
    const res = await next();
    this.log.info(`${ctx.method} ${ctx.url.pathname} -> ${res.status}`, {
      ms: +(performance.now() - started).toFixed(1),
    });
    return res;
  }
}

/** Rejects requests without the configured API key. Attach to the routes that need it. */
@Service()
export class RequireApiKey implements Middleware {
  constructor(@Inject(Env) private readonly env: Infer<typeof Env.schema>) {}

  async use(ctx: RequestContext, next: Next): Promise<Response> {
    if (ctx.headers.get('x-api-key') !== this.env.API_KEY) {
      throw new UnauthorizedException('Missing or invalid x-api-key');
    }
    return next();
  }
}
