import { bunAdapter } from '@suku/platform-bun';
import { nodeAdapter } from '@suku/platform-node';
import { createApp } from './app.js';

const adapter = typeof Bun !== 'undefined' ? bunAdapter() : nodeAdapter();
const app = await createApp({ adapter });
const server = await app.listen(Number(process.env.PORT ?? 3000));
console.log(`GraphQL at ${server.url}/graphql (open it in a browser for GraphiQL)`);
