/**
 * Spawns each server, hits it with autocannon, and prints req/s and latency next to the
 * raw baseline for the same runtime. Requires `bun run build` first and `autocannon` on PATH.
 *
 *   node --experimental-strip-types benchmarks/run.ts [--duration 5] [--connections 64] [--path /users/42] [--runtime node|bun]
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? 'true'] : null))
    .filter((x): x is [string, string] => x !== null),
);
const duration = Number(args.duration ?? 5);
const connections = Number(args.connections ?? 64);
const path = args.path ?? '/users/42';
const only = args.runtime as 'node' | 'bun' | undefined;

interface Target {
  name: string;
  runtime: 'node' | 'bun';
  file: string;
  baseline?: string;
}
const targets: Target[] = [
  { name: 'raw node:http', runtime: 'node', file: 'raw-node.ts' },
  { name: 'suku node adapter', runtime: 'node', file: 'suku-node.ts', baseline: 'raw node:http' },
  { name: 'suku app (node)', runtime: 'node', file: 'dist/app-suku.js', baseline: 'raw node:http' },
  { name: 'raw Bun.serve', runtime: 'bun', file: 'raw-bun.ts' },
  { name: 'suku bun adapter', runtime: 'bun', file: 'suku-bun.ts', baseline: 'raw Bun.serve' },
  { name: 'suku app (bun)', runtime: 'bun', file: 'app-suku.ts', baseline: 'raw Bun.serve' },
];

// Node cannot run decorators or emit decorator metadata itself, so the full app is bundled with Bun first.
const bundle = spawnSync(
  'bun',
  ['build', join(here, 'app-suku.ts'), '--target', 'node', '--outdir', join(here, 'dist')],
  {
    stdio: 'inherit',
  },
);
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

function startServer(t: Target): Promise<{ proc: ChildProcess; url: string }> {
  const cmd = t.runtime === 'node' ? 'node' : 'bun';
  const cmdArgs =
    t.runtime === 'node'
      ? ['--experimental-strip-types', join(here, t.file)]
      : [join(here, t.file)];
  const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let out = '';
    proc.stdout!.on('data', (d) => {
      out += d.toString();
      const m = /listening on (\S+)/.exec(out);
      if (m) resolve({ proc, url: m[1]! });
    });
    proc.on('exit', (code) => reject(new Error(`${t.file} exited with ${code}`)));
  });
}

interface Result {
  rps: number;
  p50: number;
  p99: number;
  errors: number;
  non2xx: number;
}

function autocannon(url: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'autocannon',
      ['-c', String(connections), '-d', String(duration), '--json', url],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
    });
    proc.on('exit', () => {
      try {
        const j = JSON.parse(out);
        resolve({
          rps: j.requests.average,
          p50: j.latency.p50,
          p99: j.latency.p99,
          errors: j.errors,
          non2xx: j.non2xx,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

const results = new Map<string, Result>();
const selected = targets.filter((t) => !only || t.runtime === only);
for (const t of selected) {
  const { proc, url } = await startServer(t);
  try {
    await autocannon(`${url}${path}`); // warm-up
    results.set(t.name, await autocannon(`${url}${path}`));
  } finally {
    proc.kill();
  }
}

console.log(
  `\n${path}  (${connections} connections, ${duration}s, after a ${duration}s warm-up)\n`,
);
console.log(
  `${'target'.padEnd(20)} ${'req/s'.padStart(9)} ${'p50 ms'.padStart(7)} ${'p99 ms'.padStart(7)} ${'vs raw'.padStart(8)}  errors`,
);
for (const t of selected) {
  const r = results.get(t.name)!;
  const base = t.baseline ? results.get(t.baseline)! : undefined;
  const vs = base ? `${(((r.rps - base.rps) / base.rps) * 100).toFixed(1)}%` : '-';
  console.log(
    `${t.name.padEnd(20)} ${r.rps.toFixed(0).padStart(9)} ${r.p50.toFixed(1).padStart(7)} ${r.p99.toFixed(1).padStart(7)} ${vs.padStart(8)}  ${r.errors + r.non2xx}`,
  );
}
