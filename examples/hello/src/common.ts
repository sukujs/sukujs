import {
  type Guard,
  type Infer,
  Logger,
  type Middleware,
  type Next,
  RequestContext,
  SetMetadata,
  UnauthorizedException,
} from '@suku/core';
import { Inject, Injectable } from '@suku/di';
import { Env } from './config.js';

/** Global middleware: one log line per request with status and duration. */
@Injectable()
export class RequestLogger implements Middleware {
  constructor(private readonly log: Logger) {}

  async use(ctx: RequestContext, next: Next<Response>): Promise<Response> {
    const started = performance.now();
    const res = await next();
    this.log.info(`${ctx.method} ${ctx.url.pathname} -> ${res.status}`, {
      ms: +(performance.now() - started).toFixed(1),
    });
    return res;
  }
}

/** Marks a handler as requiring an API key; read by ApiKeyGuard. */
export const RequireApiKey = () => SetMetadata('api-key', true);

@Injectable({ lifetime: 'scoped' })
export class ApiKeyGuard implements Guard {
  constructor(
    private readonly ctx: RequestContext,
    @Inject(Env) private readonly env: Infer<typeof Env.schema>,
  ) {}

  canActivate(): boolean {
    if (!this.ctx.getMetadata<boolean>('api-key')) return true;
    if (this.ctx.headers.get('x-api-key') === this.env.API_KEY) return true;
    throw new UnauthorizedException('Missing or invalid x-api-key');
  }
}
