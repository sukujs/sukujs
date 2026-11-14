// Node and Bun: a long-lived process that listens on a port.
// Used by PM2, systemd and Docker.
import { bunAdapter } from '@sukujs/platform-bun';
import { nodeAdapter } from '@sukujs/platform-node';
import { createApp, Env } from './app.js';

const onBun = typeof Bun !== 'undefined';
const app = await createApp({
  runtime: onBun ? 'bun' : 'node',
  adapter: onBun ? bunAdapter() : nodeAdapter(),
});
const env = app.get(Env);

const server = await app.listen({ port: env.PORT, hostname: env.HOST });
console.log(`listening on ${server.url}`);

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, closing`);
    const deadline = setTimeout(() => void app.close({ force: true }), 10_000);
    void app.close().finally(() => {
      clearTimeout(deadline);
      console.log('closed');
      process.exit(0);
    });
  });
}
