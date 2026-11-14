import { parseArgs } from 'node:util';
import {
  build,
  cliVersion,
  dev,
  generateCommand,
  type Io,
  info,
  newProject,
  start,
} from './commands.js';
import { CliError } from './errors.js';
import { Prompter } from './prompts.js';
import { SCHEMATICS } from './schematics.js';

export { DEPLOY_TARGETS, type DeployTarget } from './deploy.js';
export { CliError } from './errors.js';
export { type Names, names } from './names.js';
export { type Change, Plan } from './plan.js';
export { loadProject, type Project, type Runtime } from './project.js';
export { type Choice, Prompter } from './prompts.js';
export { type GenerateOptions, generate, SCHEMATICS, type Schematic } from './schematics.js';
export { starter } from './starter.js';

const HELP = `Suku CLI

Usage: suku <command> [options]

Commands:
  new [name]                    Create a project, asking for the options
  generate <schematic> <name>   Generate code (alias: g)
  dev                           Run the app and restart on change
  build                         Bundle the app into dist/
  start                         Run the built app
  info                          Print versions, for bug reports

Schematics:
${Object.entries(SCHEMATICS)
  .map(([name, { alias, description }]) => `  ${`${name} (${alias})`.padEnd(18)} ${description}`)
  .join('\n')}

Options for new (in a terminal, anything you leave out is asked):
  --runtime <node|bun>          Production runtime (default: node)
  --package-manager <name>      bun, npm, pnpm or yarn (default: bun)
  --deploy <targets>            docker, pm2, systemd, cloudflare, vercel or none
                                (comma-separated or repeated)
  --skip-install                Do not install dependencies
  --skip-git                    Do not run git init
  -y, --yes                     Ask nothing, use the defaults

Options for generate:
  --classless                   Functions instead of classes
  --flat                        Do not create a folder for it
  --skip-import                 Do not register it in other files
  --skip-tests                  resource: do not generate a test

Options for dev, build and start:
  --entry <file>                Entry file (default: src/main.ts)
  --target <node|bun>           build: what the bundle runs on
  --outdir <dir>                build, start: output folder (default: dist)
  --minify, --sourcemap         build
  --external <package>          build: leave a package out of the bundle (repeatable)

Everywhere:
  -d, --dry-run                 Show what would be written, write nothing
  --force                       Overwrite existing files
  -h, --help, -v, --version

Arguments after -- are passed to your app: suku dev -- --port 4000
`;

const OPTIONS = {
  runtime: { type: 'string' },
  'package-manager': { type: 'string' },
  'skip-install': { type: 'boolean' },
  'skip-git': { type: 'boolean' },
  deploy: { type: 'string', multiple: true },
  yes: { type: 'boolean', short: 'y' },
  classless: { type: 'boolean' },
  flat: { type: 'boolean' },
  'skip-import': { type: 'boolean' },
  'skip-tests': { type: 'boolean' },
  entry: { type: 'string' },
  target: { type: 'string' },
  outdir: { type: 'string' },
  minify: { type: 'boolean' },
  sourcemap: { type: 'boolean' },
  external: { type: 'string', multiple: true },
  'dry-run': { type: 'boolean', short: 'd' },
  force: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

/** Drops keys whose value is `undefined`, so optional properties stay absent. */
function defined<T extends Record<string, unknown>>(
  object: T,
): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: NonNullable<T[K]>;
  };
}

/**
 * Runs the CLI with `argv` (without `node` and the script path) and resolves with the exit
 * code. Usage mistakes are printed and return `1`; they do not throw. Questions are asked
 * only when `io.prompter` is given.
 */
export async function run(argv: string[], io: Partial<Io> = {}): Promise<number> {
  // No prompter means no questions. The executable passes one when it has a terminal; this
  // function never looks at the terminal itself, so embedding it and testing it cannot hang.
  const out: Io = {
    cwd: io.cwd ?? process.cwd(),
    log: io.log ?? console.log,
    ...(io.prompter ? { prompter: io.prompter } : {}),
  };
  const split = argv.indexOf('--');
  const own = split === -1 ? argv : argv.slice(0, split);
  const passthrough = split === -1 ? [] : argv.slice(split + 1);

  try {
    let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
    try {
      parsed = parseArgs({ args: own, options: OPTIONS, allowPositionals: true });
    } catch (error) {
      throw new CliError(`${(error as Error).message.split('. ')[0]}. Run \`suku --help\`.`);
    }
    const { values, positionals } = parsed;
    const [command, first, second] = positionals;

    if (values.version) {
      out.log(cliVersion());
      return 0;
    }
    if (values.help || command === undefined || command === 'help') {
      out.log(HELP);
      return 0;
    }

    const write = defined({ dryRun: values['dry-run'], force: values.force });
    switch (command) {
      case 'new':
      case 'n': {
        return await newProject(out, first, {
          ...write,
          ...defined({
            runtime: values.runtime,
            packageManager: values['package-manager'],
            deploy: values.deploy,
            yes: values.yes,
            skipInstall: values['skip-install'],
            skipGit: values['skip-git'],
          }),
        });
      }
      case 'generate':
      case 'g': {
        if (!first || !second) throw new CliError('Usage: suku generate <schematic> <name>');
        return generateCommand(out, first, second, {
          ...write,
          ...defined({
            classless: values.classless,
            flat: values.flat,
            skipImport: values['skip-import'],
            skipTests: values['skip-tests'],
          }),
        });
      }
      case 'dev':
        return await dev(out, defined({ entry: values.entry }), passthrough);
      case 'build':
        return await build(
          out,
          defined({
            entry: values.entry,
            target: values.target,
            outdir: values.outdir,
            minify: values.minify,
            sourcemap: values.sourcemap,
            external: values.external,
          }),
        );
      case 'start':
        return await start(
          out,
          defined({ entry: values.entry, outdir: values.outdir, runtime: values.runtime }),
          passthrough,
        );
      case 'info':
      case 'i':
        return info(out);
      default:
        throw new CliError(`Unknown command "${command}". Run \`suku --help\`.`);
    }
  } catch (error) {
    if (error instanceof CliError) {
      out.log(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
