import { nodeAdapter } from '@sukujs/platform-node';
import { handler } from './app.ts';

const server = await nodeAdapter().serve(handler, { port: 0, hostname: '127.0.0.1' });
console.log(`listening on ${server.url}`);
