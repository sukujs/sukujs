import { RequestContext, route } from '@suku/core';

/** Routes without a class. Services they need are declared and arrive in the handler. */
export const hello = route.get('/', { handle: () => ({ hello: 'world' }) });

export const health = route.get('/health', { handle: () => 'ok' });

export const whoami = route.get('/whoami', {
  services: { context: RequestContext },
  handle: ({ context }) => ({
    method: context.method,
    path: context.url.pathname,
    ua: context.headers.get('user-agent'),
  }),
});
