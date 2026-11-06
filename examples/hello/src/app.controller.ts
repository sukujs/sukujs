import { Controller, Get, RequestContext } from '@suku/core';

@Controller()
export class AppController {
  @Get()
  hello() {
    return { hello: 'world' };
  }

  @Get('health')
  health() {
    return 'ok';
  }
}

/** A request-scoped controller: a fresh instance per request, with the request context injected. */
@Controller({ path: 'whoami', lifetime: 'scoped' })
export class WhoamiController {
  constructor(private readonly ctx: RequestContext) {}

  @Get()
  whoami() {
    return {
      method: this.ctx.method,
      path: this.ctx.url.pathname,
      ua: this.ctx.headers.get('user-agent'),
    };
  }
}
