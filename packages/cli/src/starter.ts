import { type DeployTarget, deployFiles } from './deploy.js';
import { addObservability } from './observability.js';
import { addOpenApi, OPENAPI_UIS, type OpenApiUi } from './openapi';
import type { Runtime } from './project.js';

export interface StarterOptions {
  /** The package name, already validated. */
  name: string;
  runtime: Runtime;
  /** The Suku version every `@sukujs/*` dependency is pinned to. */
  version: string;
  /** Used in the README's commands. Default `bun`. */
  packageManager?: string;
  /** Deployment targets to add files for. */
  deploy?: DeployTarget[];
  /** Send errors, traces, logs and metrics with OpenTelemetry. Default: no. */
  observability?: boolean;
  /** Serve an OpenAPI document and this UI for it. Default: no. */
  openapi?: OpenApiUi;
}

/** The files of a new project, keyed by path. */
export function starter(options: StarterOptions): Record<string, string> {
  const { name, runtime, version, packageManager = 'bun', deploy = [] } = options;
  const extra = deployFiles(name, runtime, deploy);
  const pm = packageManager;
  const pmx = pm === 'bun' ? 'bunx' : pm === 'pnpm' ? 'pnpm exec' : pm === 'yarn' ? 'yarn' : 'npx';
  // Vercel compiles the function itself, so the starter lists dependencies explicitly there.
  const explicitInject = deploy.includes('vercel');
  const platform = runtime === 'bun' ? 'platform-bun' : 'platform-node';
  const adapter = runtime === 'bun' ? 'bunAdapter' : 'nodeAdapter';
  const range = `^${version}`;

  const pkg = {
    name,
    version: '0.0.1',
    private: true,
    type: 'module',
    scripts: {
      dev: 'suku dev',
      build: 'suku build',
      start: 'suku start',
      test: 'bun test',
      typecheck: 'tsc --noEmit',
      ...extra.scripts,
    },
    suku: { runtime },
    dependencies: {
      '@sukujs/core': range,
      [`@sukujs/${platform}`]: range,
      '@sukujs/security': range,
      // The API only: it does nothing until the app installs an OpenTelemetry SDK.
      '@opentelemetry/api': '^1.9.0',
      pino: '^10.0.0',
      'pino-pretty': '^13.0.0',
      zod: '^4.0.0',
    },
    devDependencies: {
      '@sukujs/cli': range,
      '@types/bun': 'latest',
      '@types/node': '^22.0.0',
      typescript: '^5.9.0',
      ...extra.devDependencies,
    },
  };

  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2023'],
      types: ['node', 'bun'],
      strict: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      useDefineForClassFields: false,
      skipLibCheck: true,
      noEmit: true,
    },
    include: deploy.includes('vercel') ? ['src', 'api'] : ['src'],
  };

  const files: Record<string, string> = {
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    'tsconfig.json': `${JSON.stringify(tsconfig, null, 2)}\n`,
    '.gitignore': 'node_modules/\ndist/\n.env\n.DS_Store\n',
    '.env.example': 'PORT=3000\nLOG_LEVEL=info\n',
    'README.md': `# ${name}

A [Suku](https://github.com/sukujs/sukujs) API.

\`\`\`bash
${pm} run dev      # start with reload on change
${pm} run test     # run the tests
${pm} run build    # bundle to dist/
${pm} run start    # run the bundle with ${runtime === 'bun' ? 'Bun' : 'Node'}
\`\`\`

The \`dev\`, \`build\` and \`test\` commands use [Bun](https://bun.sh).

## Logs

The app logs with [pino](https://getpino.io), set up in \`src/logger.ts\`. Ask for \`Logger\` from
\`@sukujs/core\` in any service to write to it.

In a terminal the lines are made for reading, by [pino-pretty](https://github.com/pinojs/pino-pretty).
Anywhere else (a container, a pipe, a log file) each line is one JSON object, which is what
log collectors expect.

\`\`\`bash
LOG_LEVEL=debug ${pm} run dev    # debug, info (default), warn or error
LOG_FORMAT=json ${pm} run dev    # force json, or pretty
\`\`\`

Every line written during an OpenTelemetry span carries its \`trace_id\` and \`span_id\`, once
the app runs with an OpenTelemetry SDK. To send logs to a collector as well, add
[pino-opentelemetry-transport](https://github.com/pinojs/pino-opentelemetry-transport).

## Generate code

\`\`\`bash
${pmx} suku generate resource products   # a CRUD feature with a test
${pmx} suku generate feature billing
${pmx} suku generate routes billing
${pmx} suku generate service billing
${pmx} suku generate middleware audit
\`\`\`
${extra.readme.length > 0 ? `\n## Deploy\n\n${extra.readme.join('\n\n')}\n` : ''}`,
    'src/main.ts': `import { Logger, singleton, Suku } from '@sukujs/core';
import { ${adapter} } from '@sukujs/${platform}';
import { securityHeaders } from '@sukujs/security';
import { AppFeature } from './app.feature';
import { Env } from './config';
import { PinoLogger, requestLogger } from './logger';

const app = await Suku.create({
  features: [Env.load(), AppFeature],
  // Replaces the built-in console logger: every \`Logger\` in the app now writes through pino.
  services: [singleton(Logger, PinoLogger)],
  // Defensive headers on every response, including 404s and errors.
  middlewares: [requestLogger, securityHeaders()],
  adapter: ${adapter}(),
});

const server = await app.listen(app.get(Env).PORT);
app.get(Logger).info(\`listening on \${server.url}\`);

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
`,
    'src/config.ts': `import { defineConfig } from '@sukujs/core';
import { z } from 'zod';

/** Validated when the app starts. A missing or malformed variable stops it before it listens. */
export const Env = defineConfig(
  'env',
  z.object({
    PORT: z.coerce.number().int().min(0).default(3000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    // Unset: readable lines in a terminal, JSON everywhere else.
    LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  }),
);
`,
    'src/logger.ts': `import { type Infer, ${explicitInject ? '' : 'Inject, '}Logger, type LogLevel, middleware${explicitInject ? '' : ', Service'} } from '@sukujs/core';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import pino from 'pino';
import pretty from 'pino-pretty';
import { Env } from './config';

/**
 * The ids of the OpenTelemetry span that is active right now, under the field names
 * OpenTelemetry tools expect. Empty until the app runs with an OpenTelemetry SDK.
 */
export function traceContext(): Record<string, string> {
  const span = trace.getActiveSpan()?.spanContext();
  if (!span || !isSpanContextValid(span)) return {};
  return {
    trace_id: span.traceId,
    span_id: span.spanId,
    trace_flags: \`0\${span.traceFlags.toString(16)}\`,
  };
}

/**
 * Suku's \`Logger\`, written with pino. In a terminal the lines are made for reading. Anywhere
 * else (a container, a pipe, a log file) each line is one JSON object, which is what log
 * collectors expect. \`LOG_FORMAT\` overrides the choice.
 */
${explicitInject ? '' : '@Service()\n'}export class PinoLogger extends Logger {
${explicitInject ? '  static inject = [Env];\n\n' : ''}  readonly pino: pino.Logger;

  constructor(${explicitInject ? '' : '@Inject(Env) '}env: Infer<typeof Env.schema>) {
    super();
    // \`mixin\` runs for every line, so each one gets the trace it was written in.
    const format = env.LOG_FORMAT ?? (process.stdout.isTTY ? 'pretty' : 'json');
    this.pino = pino(
      { level: env.LOG_LEVEL, mixin: traceContext },
      // https://github.com/pinojs/pino-pretty#options
      format === 'pretty'
        ? pretty({
            singleLine: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            sync: true,
          })
        : undefined,
    );
  }

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    this.pino[level](meta ?? {}, message);
  }

  /** Hands an \`Error\` to pino itself, which records its type, message, stack and cause. */
  override error(message: unknown, meta?: Record<string, unknown>): void {
    if (message instanceof Error) {
      this.pino.error({ ...meta, err: message }, message.message);
    } else {
      super.error(message, meta);
    }
  }
}

/** One line per request: method, path, status and how long it took. */
export const requestLogger = middleware(async (ctx, next) => {
  const started = performance.now();
  const response = await next();
  ctx.provider.get(Logger).info('request', {
    method: ctx.method,
    path: ctx.url.pathname,
    status: response.status,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
});
`,
    'src/app.feature.ts': `import { feature, route } from '@sukujs/core';
import { HelloFeature } from './hello/hello.feature';

export const health = route.get('/health', {
  handle: () => ({ status: 'ok' }),
});

/** The root feature. \`suku generate feature\` and \`resource\` add theirs to \`imports\`. */
export const AppFeature = feature('app', {
  imports: [HelloFeature],
  routes: [health],
});
`,
    'src/hello/hello.feature.ts': `import { feature } from '@sukujs/core';
import { HelloRoutes } from './hello.routes';
import { HelloService } from './hello.service';

export const HelloFeature = feature('hello', {
  routes: [HelloRoutes],
  services: [HelloService],
});
`,
    'src/hello/hello.service.ts': `import { Service } from '@sukujs/core';

@Service()
export class HelloService {
  greet(name: string): string {
    return \`Hello, \${name}!\`;
  }
}
`,
    'src/hello/hello.routes.ts': `import { Routes, route } from '@sukujs/core';
import { z } from 'zod';
import { HelloService } from './hello.service';

@Routes('/hello')
export class HelloRoutes {${explicitInject ? '\n  static inject = [HelloService];\n' : ''}
  constructor(private readonly hello: HelloService) {}

  greet = route.get('/:name', {
    params: z.object({ name: z.string().min(1).max(50) }),
    handle: ({ params }) => ({ message: this.hello.greet(params.name) }),
  });
}
`,
    'src/app.test.ts': `import { expect, test } from 'bun:test';
import { Suku } from '@sukujs/core';
import { AppFeature } from './app.feature';

// No adapter and no port: app.handle runs a request through the whole app in process.
const app = await Suku.create({ features: [AppFeature] });
const get = (path: string) => app.handle(new Request(\`http://test\${path}\`));

test('GET /health', async () => {
  const response = await get('/health');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('GET /hello/:name', async () => {
  expect(await (await get('/hello/Ada')).json()).toEqual({ message: 'Hello, Ada!' });
});
`,
  };
  const all = { ...files, ...extra.files };
  if (options.observability) {
    addObservability({
      sourceRoot: 'src',
      entry: 'src/main.ts',
      read: (path) => all[path],
      update: (path, content) => void (all[path] = content),
      // Every edit applies to the starter's own files, so there is nothing to report.
      note: () => undefined,
    });
    all['README.md'] += `
## Observability

Request traces, logs, errors and runtime metrics are sent with OpenTelemetry to the address
in \`OTLP_ENDPOINT\`. Any OTLP endpoint works: a collector, Grafana Cloud, Sentry, Honeycomb
and others. If it needs an API key, put it in \`OTLP_HEADER\` as \`name=value\`.

\`OTLP_ENDPOINT\` is required: \`src/config.ts\` stops the app at startup without it. The tests
do not load the config, so they send nothing.

- \`observability()\` in \`src/main.ts\` is the whole setup. It comes from \`@sukujs/observability\`.
- \`@Traced()\` on a method records a span for it. \`telemetry.captureException(error)\`
  reports an error you handled yourself. Both come from the same package.
`;
  }
  if (options.openapi) {
    addOpenApi(
      {
        sourceRoot: 'src',
        entry: 'src/main.ts',
        read: (path) => all[path],
        update: (path, content) => void (all[path] = content),
        // Every edit applies to the starter's own files, so there is nothing to report.
        note: () => undefined,
      },
      options.openapi,
    );
    all['README.md'] += `
## API docs

The app describes itself: \`/openapi.json\` is an OpenAPI 3.1 document built from the routes,
and \`/docs\` shows it with ${OPENAPI_UIS[options.openapi].label}. Both come from \`openapi()\` in
\`src/app.feature.ts\`, from \`@sukujs/openapi\`.

- Parameters, bodies and responses come from each route's schemas. Give a route a
  \`response\` schema to document what it returns.
- \`apiDoc({ summary, tags, responses })\` in a route's \`meta\` adds the rest.
- To keep the docs out of production, list \`openapi()\` only when you want it served.
`;
  }
  return all;
}
