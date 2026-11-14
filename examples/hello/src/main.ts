import { type ConsoleLogger, Logger, Suku } from '@sukujs/core';
import { bunAdapter } from '@sukujs/platform-bun';
import { nodeAdapter } from '@sukujs/platform-node';
import { health, hello, Uptime, whoami } from './app.routes';
import { RequestLogger } from './common';
import { Env } from './config';
import { UsersFeature } from './users/users.feature';

const adapter = typeof Bun !== 'undefined' ? bunAdapter() : nodeAdapter();

const app = await Suku.create({
  features: [Env.load(), UsersFeature],
  routes: [hello, health, whoami],
  services: [Uptime],
  middlewares: [RequestLogger],
  adapter,
});

const env = app.get(Env);
(app.get(Logger) as ConsoleLogger).level = env.LOG_LEVEL;

const server = await app.listen(env.PORT);
console.log(`listening on ${server.url} (${adapter.name})`);
for (const r of app.routes) console.log(`  ${r.method.padEnd(6)} ${r.path}  -> ${r.name}`);
