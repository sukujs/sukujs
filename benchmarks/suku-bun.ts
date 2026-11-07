import { bunAdapter } from '@suku/platform-bun';
import { handler } from './app.ts';

const server = await bunAdapter().serve(handler, { port: 0, hostname: '127.0.0.1' });
console.log(`listening on ${server.url}`);
