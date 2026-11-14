import { CliError } from './errors.js';
import type { Runtime } from './project.js';

export const DEPLOY_TARGETS = {
  docker: { label: 'Docker', hint: 'Dockerfile and docker-compose.yml' },
  pm2: { label: 'VPS with PM2', hint: 'ecosystem.config.cjs' },
  systemd: { label: 'VPS with systemd', hint: 'a unit file' },
  cloudflare: { label: 'Cloudflare Workers', hint: 'src/worker.ts and wrangler.jsonc' },
  vercel: { label: 'Vercel', hint: 'api/index.ts and vercel.json' },
} as const;

export type DeployTarget = keyof typeof DEPLOY_TARGETS;

/** Parses `docker,pm2` or repeated flags into known targets. `none` means an empty list. */
export function parseDeployTargets(input: string[]): DeployTarget[] {
  const out = new Set<DeployTarget>();
  for (const name of input.flatMap((value) => value.split(',')).map((value) => value.trim())) {
    if (name === '' || name === 'none') continue;
    if (!(name in DEPLOY_TARGETS)) {
      throw new CliError(
        `Unknown deployment target "${name}". Use any of: ${Object.keys(DEPLOY_TARGETS).join(', ')}, or none.`,
      );
    }
    out.add(name as DeployTarget);
  }
  return [...out];
}

export interface DeployFiles {
  files: Record<string, string>;
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  /** One README section per target. */
  readme: string[];
}

/** The files, scripts and README notes each chosen deployment target adds to a new project. */
export function deployFiles(name: string, runtime: Runtime, targets: DeployTarget[]): DeployFiles {
  const out: DeployFiles = { files: {}, scripts: {}, devDependencies: {}, readme: [] };
  const bun = runtime === 'bun';
  const startCommand = bun ? 'bun dist/main.js' : 'node dist/main.js';

  if (targets.includes('docker')) {
    out.files.Dockerfile = `# syntax=docker/dockerfile:1
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install
COPY . .
RUN bun run build

FROM ${bun ? 'oven/bun:1-alpine' : 'node:22-alpine'} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# The bundle carries its dependencies, so the image needs only this.
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
USER ${bun ? 'bun' : 'node'}
EXPOSE 3000
CMD [${startCommand
      .split(' ')
      .map((part) => `"${part}"`)
      .join(', ')}]
`;
    out.files['.dockerignore'] = 'node_modules\ndist\n.git\n.env\n';
    out.files['docker-compose.yml'] = `services:
  api:
    build: .
    ports:
      - '3000:3000'
    environment:
      PORT: 3000
    restart: unless-stopped
    stop_grace_period: 15s
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://127.0.0.1:3000/health']
      interval: 30s
      timeout: 3s
      retries: 3
`;
    out.readme.push(`### Docker

\`\`\`bash
docker compose up -d --build
curl http://localhost:3000/health
\`\`\``);
  }

  if (targets.includes('pm2')) {
    out.files['ecosystem.config.cjs'] = `module.exports = {
  apps: [
    {
      name: '${name}',
      script: 'dist/main.js',
${
  bun
    ? `      interpreter: 'bun',
      instances: 1,
      exec_mode: 'fork',`
    : `      instances: 'max', // one worker per CPU core
      exec_mode: 'cluster',`
}
      kill_timeout: 15000, // longer than the shutdown deadline in src/main.ts
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
`;
    out.readme.push(`### VPS with PM2

\`\`\`bash
bun install && bun run build
pm2 startOrReload ecosystem.config.cjs
pm2 save
\`\`\``);
  }

  if (targets.includes('systemd')) {
    out.files[`deploy/${name}.service`] = `[Unit]
Description=${name}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/${name}
Environment=NODE_ENV=production
EnvironmentFile=/var/www/${name}/.env
ExecStart=${bun ? '/usr/local/bin/bun' : '/usr/bin/node'} dist/main.js
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`;
    out.readme.push(`### VPS with systemd

Copy the project to \`/var/www/${name}\`, build it, then install the unit:

\`\`\`bash
sudo cp deploy/${name}.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ${name}
\`\`\``);
  }

  if (targets.includes('cloudflare')) {
    out.files['src/worker.ts'] = `import { Suku, type SukuApplication } from '@sukujs/core';
import { AppFeature } from './app.feature';
import { Env } from './config';

// Bindings arrive with the first request, so the app is created then and kept.
let app: Promise<SukuApplication> | undefined;

const createApp = async (env: Record<string, unknown>) =>
  Suku.create({ features: [await Env.load({ ...env }), AppFeature] });

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    app ??= createApp(env);
    const { handle } = await app;
    const remoteAddress = request.headers.get('cf-connecting-ip') ?? undefined;
    return handle(request, remoteAddress ? { remoteAddress } : undefined);
  },
};
`;
    out.files['wrangler.jsonc'] = `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${name}",
  // Bun bundles the Worker first, because it keeps the decorator metadata that
  // constructor injection needs.
  "main": "dist/worker.js",
  "compatibility_date": "${new Date().toISOString().slice(0, 10)}",
  "build": {
    "command": "bun run build:worker"
  }
}
`;
    out.scripts['build:worker'] =
      'bun build src/worker.ts --target browser --format esm --outfile dist/worker.js';
    out.scripts['dev:worker'] = 'wrangler dev';
    out.scripts['deploy:cloudflare'] = 'wrangler deploy';
    out.devDependencies.wrangler = '^4.0.0';
    out.readme.push(`### Cloudflare Workers

\`\`\`bash
bun run dev:worker          # run locally in the Workers runtime
bun run deploy:cloudflare
\`\`\``);
  }

  if (targets.includes('vercel')) {
    out.files['api/index.ts'] = `import { Suku } from '@sukujs/core';
import { AppFeature } from '../src/app.feature';
import { Env } from '../src/config';

const app = await Suku.create({ features: [Env.load(), AppFeature] });

// One function for the whole API. vercel.json sends every path here.
export default {
  fetch: (request: Request) => app.handle(request),
};
`;
    out.files['vercel.json'] = `${JSON.stringify(
      { rewrites: [{ source: '/(.*)', destination: '/api' }] },
      null,
      2,
    )}\n`;
    out.scripts['dev:vercel'] = 'vercel dev';
    out.scripts['deploy:vercel'] = 'vercel deploy';
    out.devDependencies.vercel = 'latest';
    out.readme.push(`### Vercel

\`\`\`bash
bun run dev:vercel
bun run deploy:vercel
\`\`\``);
  }

  return out;
}
