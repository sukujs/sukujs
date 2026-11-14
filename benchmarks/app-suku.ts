import { Routes, route, Suku } from '@suku/core';
import { bunAdapter } from '@suku/platform-bun';
import { nodeAdapter } from '@suku/platform-node';

@Routes('/users')
class UsersRoutes {
  get = route.get('/:id', { handle: ({ params }) => ({ id: params.id }) });
}

const root = route.get('/', { handle: () => ({ hello: 'world' }) });

const adapter = typeof Bun !== 'undefined' ? bunAdapter() : nodeAdapter();
const app = await Suku.create({ routes: [UsersRoutes, root], adapter });
const server = await app.listen({ port: 0, hostname: '127.0.0.1' });
console.log(`listening on ${server.url}`);
