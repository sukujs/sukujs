import { type FetchHandler, pathnameOf, Router } from '@suku/core';

type Handler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;
const router = new Router<Handler>()
  .add('GET', '/', () => Response.json({ hello: 'world' }))
  .add('GET', '/users/:id', (_req, p) => Response.json({ id: p.id }));

export const handler: FetchHandler = (req) => {
  const match = router.match(req.method, pathnameOf(req.url));
  if (!match) return new Response('Not Found', { status: 404 });
  return match.handler(req, match.params);
};
