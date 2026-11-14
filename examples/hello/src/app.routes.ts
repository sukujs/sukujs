import { RequestContext, route, service } from '@suku/core';

/** A service without a class: its dependencies are listed, its type is inferred. */
export const Uptime = service('uptime', () => {
  const started = Date.now();
  return { seconds: () => Math.round((Date.now() - started) / 1000) };
});

/** Routes without a class. Services they need are declared and arrive in the handler. */
export const hello = route.get('/', { handle: () => ({ hello: 'world' }) });

export const health = route.get('/health', {
  services: { uptime: Uptime },
  handle: ({ uptime }) => ({ status: 'ok', uptime: uptime.seconds() }),
});

export const whoami = route.get('/whoami', {
  services: { context: RequestContext },
  handle: ({ context }) => ({
    method: context.method,
    path: context.url.pathname,
    ua: context.headers.get('user-agent'),
  }),
});
