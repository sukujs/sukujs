import { type DeployTarget, deployFiles } from './deploy.js';
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
    '.env.example': 'PORT=3000\n',
    'README.md': `# ${name}

A [Suku](https://github.com/sukujs/sukujs) API.

\`\`\`bash
${pm} run dev      # start with reload on change
${pm} run test     # run the tests
${pm} run build    # bundle to dist/
${pm} run start    # run the bundle with ${runtime === 'bun' ? 'Bun' : 'Node'}
\`\`\`

The \`dev\`, \`build\` and \`test\` commands use [Bun](https://bun.sh).

## Generate code

\`\`\`bash
${pmx} suku generate resource products   # a CRUD feature with a test
${pmx} suku generate feature billing
${pmx} suku generate routes billing
${pmx} suku generate service billing
${pmx} suku generate middleware audit
\`\`\`
${extra.readme.length > 0 ? `\n## Deploy\n\n${extra.readme.join('\n\n')}\n` : ''}`,
    'src/main.ts': `import { Suku } from '@sukujs/core';
import { ${adapter} } from '@sukujs/${platform}';
import { AppFeature } from './app.feature';
import { Env } from './config';

const app = await Suku.create({ features: [Env.load(), AppFeature], adapter: ${adapter}() });

const server = await app.listen(app.get(Env).PORT);
console.log(\`listening on \${server.url}\`);

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
  }),
);
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
  return { ...files, ...extra.files };
}
