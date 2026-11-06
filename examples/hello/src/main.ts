import { ConsoleLogger, Logger, Suku } from '@suku/core';
import { bunAdapter } from '@suku/platform-bun';
import { nodeAdapter } from '@suku/platform-node';
import { AppModule } from './app.module.js';
import { RequestLogger } from './common.js';
import { Env } from './config.js';

const adapter = typeof Bun !== 'undefined' ? bunAdapter() : nodeAdapter();
const app = await Suku.create(AppModule, { adapter, middleware: [RequestLogger] });

const env = app.get(Env);
(app.get(Logger) as ConsoleLogger).level = env.LOG_LEVEL;

const server = await app.listen(env.PORT);
console.log(`listening on ${server.url} (${adapter.name})`);
for (const r of app.routes)
  console.log(`  ${r.method.padEnd(6)} ${r.path}  -> ${r.controller}.${r.handler}`);
