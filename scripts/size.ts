/**
 * Fails when a package's minified ESM bundle exceeds its byte budget.
 * Measures what a consumer's bundler would ship, not the readable dist output.
 */
import { resolve } from 'node:path';

const budgets: Record<string, number> = {
  'packages/di/src/index.ts': 16 * 1024,
  'packages/core/src/index.ts': 24 * 1024,
  'packages/platform-node/src/index.ts': 4 * 1024,
  'packages/platform-bun/src/index.ts': 2 * 1024,
  'packages/crypto/src/index.ts': 12 * 1024,
  'packages/security/src/index.ts': 8 * 1024,
  'packages/graphql/src/index.ts': 6 * 1024,
};

let failed = false;
for (const [entry, limit] of Object.entries(budgets)) {
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, '..', entry)],
    minify: true,
    target: 'node',
    write: false,
    external: ['@suku/*', 'graphql', 'graphql-yoga'],
  });
  if (!result.success) {
    console.error(result.logs);
    process.exit(1);
  }
  const size = result.outputs.reduce((n, o) => n + o.size, 0);
  const ok = size <= limit;
  failed ||= !ok;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${entry}: ${(size / 1024).toFixed(1)} KB minified (budget ${limit / 1024} KB)`,
  );
}
if (failed) process.exit(1);
