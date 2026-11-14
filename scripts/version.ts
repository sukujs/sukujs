/**
 * Enforces the unified version rule (see CLAUDE.md): every package under `packages/` has the
 * same version, and internal dependencies are `workspace:*`.
 *
 *   bun scripts/version.ts check            fail if versions differ
 *   bun scripts/version.ts set 0.3.0        set every package to an exact version
 *   bun scripts/version.ts bump patch       bump every package: patch | minor | major
 *
 * `set` and `bump` only edit package.json files. Committing and tagging stay manual.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const packagesDir = join(root, 'packages');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
const DEP_FIELDS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
  'devDependencies',
] as const;

interface Pkg {
  file: string;
  raw: string;
  json: { name: string; version?: string; private?: boolean } & Partial<
    Record<(typeof DEP_FIELDS)[number], Record<string, string>>
  >;
}

function load(): Pkg[] {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = join(packagesDir, entry.name, 'package.json');
      const raw = readFileSync(file, 'utf8');
      return { file, raw, json: JSON.parse(raw) };
    })
    .sort((a, b) => a.json.name.localeCompare(b.json.name));
}

function problems(pkgs: Pkg[]): string[] {
  const out: string[] = [];
  const versions = new Map<string, string[]>();
  const names = new Set(pkgs.map((p) => p.json.name));
  for (const { json } of pkgs) {
    if (json.private)
      out.push(`${json.name} is under packages/ but marked private; publishable packages only.`);
    if (!json.version) {
      out.push(`${json.name} has no version.`);
      continue;
    }
    if (!SEMVER.test(json.version))
      out.push(`${json.name} has an invalid version "${json.version}".`);
    versions.set(json.version, [...(versions.get(json.version) ?? []), json.name]);
    for (const field of DEP_FIELDS) {
      for (const [dep, range] of Object.entries(json[field] ?? {})) {
        if (names.has(dep) && range !== 'workspace:*') {
          out.push(
            `${json.name} ${field} lists ${dep} as "${range}"; internal dependencies must be "workspace:*".`,
          );
        }
      }
    }
  }
  if (versions.size > 1) {
    const detail = [...versions]
      .map(([version, who]) => `    ${version}: ${who.join(', ')}`)
      .join('\n');
    out.push(`Packages do not share one version:\n${detail}`);
  }
  return out;
}

function current(pkgs: Pkg[]): string {
  const version = pkgs[0]?.json.version;
  if (!version) throw new Error('No packages found.');
  return version;
}

function write(pkgs: Pkg[], version: string): void {
  for (const pkg of pkgs) {
    // Replace only the version line, so formatting and key order are untouched.
    const next = pkg.raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
    if (next === pkg.raw && pkg.json.version !== version)
      throw new Error(`Could not update ${pkg.file}`);
    writeFileSync(pkg.file, next);
  }
}

const [command, argument] = process.argv.slice(2);
const pkgs = load();

if (command === 'check' || command === undefined) {
  const found = problems(pkgs);
  if (found.length) {
    console.error(`Unified version check failed:\n${found.map((p) => `  - ${p}`).join('\n')}`);
    if (found.some((p) => p.startsWith('Packages do not share'))) {
      console.error('\nFix with: bun scripts/version.ts set <version>');
    }
    process.exit(1);
  }
  console.log(`ok   ${pkgs.length} packages at ${current(pkgs)}`);
} else if (command === 'set' || command === 'bump') {
  let version: string;
  if (command === 'set') {
    if (!argument || !SEMVER.test(argument)) {
      console.error('Usage: bun scripts/version.ts set <x.y.z>');
      process.exit(1);
    }
    version = argument;
  } else {
    const before = problems(pkgs);
    if (before.length) {
      console.error('Cannot bump while versions differ. Run `set <version>` first.');
      process.exit(1);
    }
    const match = SEMVER.exec(current(pkgs));
    if (!match || !['patch', 'minor', 'major'].includes(argument ?? '')) {
      console.error('Usage: bun scripts/version.ts bump <patch|minor|major>');
      process.exit(1);
    }
    const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
    version =
      argument === 'major'
        ? `${major + 1}.0.0`
        : argument === 'minor'
          ? `${major}.${minor + 1}.0`
          : `${major}.${minor}.${patch + 1}`;
  }
  const from = [...new Set(pkgs.map((p) => p.json.version))].join(', ');
  write(pkgs, version);
  console.log(`set  ${pkgs.length} packages: ${from} -> ${version}`);
  console.log(`next git commit -am "chore(release): v${version}" && git tag v${version}`);
} else {
  console.error('Usage: bun scripts/version.ts <check | set <x.y.z> | bump <patch|minor|major>>');
  process.exit(1);
}
