/**
 * Publishes every package under `packages/` at the shared version, in dependency order.
 *
 *   bun scripts/publish.ts --dry-run     show what would be published, publish nothing
 *   bun scripts/publish.ts               publish for real
 *   bun scripts/publish.ts --tag next    publish under a dist-tag other than `latest`
 *
 * It refuses to run unless: versions are unified and not 0.0.0, the git tree is clean and
 * tagged with that version, you are logged in to npm, and none of the versions exist yet.
 * `bun publish` replaces `workspace:*` with the real version in the published package.json.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const dryRun = process.argv.includes('--dry-run');
const tagIndex = process.argv.indexOf('--tag');
const distTag = tagIndex === -1 ? 'latest' : process.argv[tagIndex + 1];

const run = (cmd: string, args: string[], cwd = root) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8' });
const fail = (message: string): never => {
  console.error(`\nCannot publish: ${message}`);
  process.exit(1);
};

interface Pkg {
  dir: string;
  name: string;
  version: string;
  internal: string[];
}

const all = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e): Pkg => {
    const dir = join(root, 'packages', e.name);
    const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const deps = { ...json.dependencies, ...json.peerDependencies };
    return {
      dir,
      name: json.name,
      version: json.version,
      internal: Object.keys(deps).filter((d) => d.startsWith('@sukujs/')),
    };
  });

// Dependencies first, so a consumer never sees a package whose dependency is not out yet.
const ordered: Pkg[] = [];
const visit = (pkg: Pkg, trail: string[] = []) => {
  if (ordered.includes(pkg)) return;
  if (trail.includes(pkg.name)) fail(`circular dependency: ${[...trail, pkg.name].join(' -> ')}`);
  for (const dep of pkg.internal) {
    const found = all.find((p) => p.name === dep);
    if (found) visit(found, [...trail, pkg.name]);
  }
  ordered.push(pkg);
};
for (const pkg of all) visit(pkg);

// --- preconditions -----------------------------------------------------------------
if (run('bun', ['scripts/version.ts', 'check']).status !== 0)
  fail('versions are not unified. Run `bun run version:check`.');
const version = ordered[0]!.version;
if (version === '0.0.0')
  fail('the version is still 0.0.0. Run `bun run version:bump <patch|minor|major>` first.');

const problems: string[] = [];
if (run('git', ['status', '--porcelain']).stdout.trim() !== '')
  problems.push('the git working tree has uncommitted changes');
const tags = run('git', ['tag', '--points-at', 'HEAD']).stdout.split('\n');
if (!tags.includes(`v${version}`)) problems.push(`HEAD is not tagged v${version}`);

const who = run('npm', ['whoami']);
if (who.status !== 0) problems.push('you are not logged in to npm (run `npm login`)');

for (const pkg of ordered) {
  const view = run('npm', ['view', `${pkg.name}@${version}`, 'version']);
  if (view.status === 0 && view.stdout.trim() === version)
    problems.push(`${pkg.name}@${version} is already published`);
}

console.log(
  `${dryRun ? 'Dry run for' : 'Publishing'} ${ordered.length} packages at ${version} (tag: ${distTag})`,
);
console.log(`npm user: ${who.status === 0 ? who.stdout.trim() : '(not logged in)'}`);
console.log(`order: ${ordered.map((p) => p.name).join(', ')}\n`);

if (problems.length) {
  for (const p of problems) console.error(`  - ${p}`);
  if (!dryRun) fail('fix the items above.');
  console.error('  (dry run: continuing to show package contents)\n');
}

// --- publish -------------------------------------------------------------------------
for (const pkg of ordered) {
  const args = [
    'publish',
    '--access',
    'public',
    '--tag',
    distTag!,
    ...(dryRun ? ['--dry-run'] : []),
  ];
  if (dryRun) {
    const result = run('bun', args, pkg.dir);
    const summary = (result.stdout + result.stderr)
      .split('\n')
      .filter((l) => /Total files|Unpacked size|Tag:|Access:|error|\+ @sukujs/.test(l));
    console.log(`${pkg.name}@${version}\n  ${summary.join('\n  ')}`);
    continue;
  }
  // A real publish runs attached to the terminal, so npm's one-time-code prompt can appear.
  console.log(`\n${pkg.name}@${version}`);
  const result = spawnSync('bun', args, { cwd: pkg.dir, stdio: 'inherit' });
  if (result.status !== 0) {
    fail(`${pkg.name} failed to publish. Packages before it in the order are already out.`);
  }
}
console.log(
  dryRun
    ? '\nDry run complete. Nothing was published.'
    : `\nPublished ${ordered.length} packages at ${version}.`,
);
