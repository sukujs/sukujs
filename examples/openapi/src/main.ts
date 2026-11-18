import { Logger, singleton, Suku } from '@sukujs/core';
import { bunAdapter } from '@sukujs/platform-bun';
import { securityHeaders } from '@sukujs/security';
import { AppFeature } from './app.feature';
import { Env } from './config';
import { PinoLogger, requestLogger } from './logger';

const app = await Suku.create({
  features: [Env.load(), AppFeature],
  // Replaces the built-in console logger: every `Logger` in the app now writes through pino.
  services: [singleton(Logger, PinoLogger)],
  // Defensive headers on every response, including 404s and errors.
  middlewares: [requestLogger, securityHeaders()],
  adapter: bunAdapter(),
});

const server = await app.listen(app.get(Env).PORT);
app.get(Logger).info(`listening on ${server.url}`);

// Finish requests in flight, then close. Give up after ten seconds.
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => void app.close({ force: true }), 10_000);
    void app.close().finally(() => {
      clearTimeout(deadline);
      process.exit(0);
    });
  });
}
