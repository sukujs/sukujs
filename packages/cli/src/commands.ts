import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DEPLOY_TARGETS, type DeployTarget, parseDeployTargets } from './deploy.js';
import { CliError } from './errors.js';
import { names } from './names.js';
import { Plan } from './plan.js';
import { loadProject, type Runtime } from './project.js';
import type { Prompter } from './prompts.js';
import { exec, versionOf } from './run.js';
import { type GenerateOptions, generate, resolveSchematic } from './schematics.js';
import { starter } from './starter.js';

export interface Io {
  cwd: string;
  log: (line: string) => void;
  /** Present when questions can be asked: a terminal is attached. */
  prompter?: Prompter;
}

/** The version of this CLI, which is the version of every `@sukujs/*` package. */
export function cliVersion(): string {
  const file = new URL('../package.json', import.meta.url);
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

function asRuntime(value: string | undefined, fallback: Runtime): Runtime {
  if (value === undefined) return fallback;
  if (value !== 'node' && value !== 'bun') {
    throw new CliError(`The runtime must be "node" or "bun", not "${value}".`);
  }
  return value;
}

export interface NewOptions {
  runtime?: string;
  packageManager?: string;
  /** Deployment targets, as given on the command line: `['docker,pm2']`. */
  deploy?: string[];
  skipInstall?: boolean;
  skipGit?: boolean;
  /** Accept the default for every question that a flag did not answer. */
  yes?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

const MANAGERS = ['bun', 'npm', 'pnpm', 'yarn'];

/**
 * Creates a project. In a terminal it asks for whatever the flags left open; with `--yes`,
 * or when there is no terminal, it uses the defaults: Node, Bun as the package manager, no
 * deployment files, a git repository and an install.
 */
export async function newProject(
  io: Io,
  input: string | undefined,
  options: NewOptions,
): Promise<number> {
  const ask = options.yes ? undefined : io.prompter;

  const target = input ?? (ask ? await ask.text('Project name', 'my-api') : undefined);
  if (!target) throw new CliError('Usage: suku new <name>');
  const root = resolve(io.cwd, target);
  const name = names(basename(root)).kebab;
  if (existsSync(root) && readdirSync(root).length > 0 && !options.force) {
    throw new CliError(`${target} already exists and is not empty. Pass --force to write into it.`);
  }

  const runtime = asRuntime(
    options.runtime ??
      (ask
        ? await ask.select('Production runtime', [
            { value: 'node', label: 'Node.js', hint: 'bundled with Bun, run with Node' },
            { value: 'bun', label: 'Bun' },
          ])
        : undefined),
    'node',
  );

  const manager =
    options.packageManager ??
    (ask
      ? await ask.select(
          'Package manager',
          MANAGERS.map((value) => ({
            value,
            label: value,
            ...(value === 'bun' ? { hint: 'default' } : {}),
          })),
        )
      : 'bun');
  if (!MANAGERS.includes(manager)) {
    throw new CliError(`Unknown package manager "${manager}". Use one of: ${MANAGERS.join(', ')}.`);
  }

  const deploy = options.deploy
    ? parseDeployTargets(options.deploy)
    : ask
      ? await ask.multiselect(
          'Deployment targets',
          Object.entries(DEPLOY_TARGETS).map(([value, { label, hint }]) => ({
            value: value as DeployTarget,
            label,
            hint,
          })),
        )
      : [];

  const git =
    options.skipGit === undefined && ask
      ? await ask.confirm('Initialise a git repository?')
      : !options.skipGit;
  const install =
    options.skipInstall === undefined && ask
      ? await ask.confirm(`Install dependencies with ${manager}?`)
      : !options.skipInstall;

  const plan = new Plan(root);
  const files = starter({ name, runtime, version: cliVersion(), packageManager: manager, deploy });
  for (const [path, content] of Object.entries(files)) plan.create(path, content);
  if (ask) io.log('');
  plan.commit({
    log: io.log,
    ...(options.dryRun ? { dryRun: true } : {}),
    force: options.force === true,
  });
  if (options.dryRun) return 0;

  if (git && versionOf('git')) {
    await exec('git', ['init', '--quiet'], { cwd: root }).catch(() => 1);
  }
  if (install) {
    io.log(`\nInstalling dependencies with ${manager}...`);
    const code = await exec(manager, ['install'], { cwd: root });
    if (code !== 0) {
      io.log(`\nThe install failed. Run \`${manager} install\` in ${target} once it is fixed.`);
      return code;
    }
  }
  io.log(`\nCreated ${name}. Next:\n\n  cd ${target}`);
  if (!install) io.log(`  ${manager} install`);
  io.log(`  ${manager} run dev\n`);
  return 0;
}

export interface GenerateCommandOptions extends GenerateOptions {
  dryRun?: boolean;
  force?: boolean;
}

export function generateCommand(
  io: Io,
  schematic: string,
  name: string,
  options: GenerateCommandOptions,
): number {
  const project = loadProject(io.cwd);
  const plan = new Plan(project.root);
  generate(plan, project, resolveSchematic(schematic), name, options);
  plan.commit({
    log: io.log,
    ...(options.dryRun ? { dryRun: true } : {}),
    force: options.force === true,
  });
  return 0;
}

function entryOf(io: Io, override?: string): string {
  const entry = override ?? loadProject(io.cwd).entry;
  if (!existsSync(join(io.cwd, entry))) throw new CliError(`Entry file ${entry} does not exist.`);
  return entry;
}

/** Runs the app with Bun and restarts it when a source file changes. */
export function dev(io: Io, options: { entry?: string }, passthrough: string[]): Promise<number> {
  const entry = entryOf(io, options.entry);
  return exec('bun', ['--watch', entry, ...passthrough], {
    cwd: io.cwd,
    env: { NODE_ENV: process.env.NODE_ENV ?? 'development' },
  });
}

export interface BuildOptions {
  entry?: string;
  target?: string;
  outdir?: string;
  minify?: boolean;
  sourcemap?: boolean;
  external?: string[];
}

/** Bundles the app, with its dependencies, into one file that the runtime can start. */
export async function build(io: Io, options: BuildOptions): Promise<number> {
  const project = loadProject(io.cwd);
  const entry = entryOf(io, options.entry);
  const target = asRuntime(options.target, project.runtime);
  const outdir = options.outdir ?? 'dist';
  const args = ['build', entry, '--target', target, '--outdir', outdir];
  if (options.minify) args.push('--minify');
  if (options.sourcemap) args.push('--sourcemap=linked');
  for (const name of options.external ?? []) args.push('--external', name);
  const code = await exec('bun', args, { cwd: io.cwd });
  if (code === 0) io.log(`\nBuilt for ${target}. Start it with: suku start`);
  return code;
}

/** Runs the built app with the project's production runtime. */
export function start(
  io: Io,
  options: { entry?: string; outdir?: string; runtime?: string },
  passthrough: string[],
): Promise<number> {
  const project = loadProject(io.cwd);
  const runtime = asRuntime(options.runtime, project.runtime);
  const source = options.entry ?? project.entry;
  const file = join(options.outdir ?? 'dist', basename(source).replace(/\.[cm]?tsx?$/, '.js'));
  if (!existsSync(join(io.cwd, file))) {
    throw new CliError(`${file} does not exist. Run \`suku build\` first.`);
  }
  return exec(runtime, [file, ...passthrough], {
    cwd: io.cwd,
    env: { NODE_ENV: process.env.NODE_ENV ?? 'production' },
  });
}

/** Prints the versions that matter when reporting a problem. */
export function info(io: Io): number {
  io.log(`Suku CLI   ${cliVersion()}`);
  io.log(`Node       ${process.version.replace(/^v/, '')}`);
  io.log(`Bun        ${versionOf('bun') ?? 'not installed'}`);
  io.log(`Platform   ${process.platform} ${process.arch}`);
  if (!existsSync(join(io.cwd, 'package.json'))) return 0;
  const project = loadProject(io.cwd);
  const packages = Object.entries(project.dependencies).filter(([name]) =>
    name.startsWith('@sukujs/'),
  );
  io.log(`Runtime    ${project.runtime}`);
  io.log(`Entry      ${project.entry}`);
  for (const [name, range] of packages.sort()) {
    const installed = join(io.cwd, 'node_modules', name, 'package.json');
    const version = existsSync(installed)
      ? (JSON.parse(readFileSync(installed, 'utf8')) as { version: string }).version
      : 'not installed';
    io.log(`${name.padEnd(24)} ${version} (wanted ${range})`);
  }
  return 0;
}
