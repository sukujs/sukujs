import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { CliError } from './errors.js';

export type Runtime = 'node' | 'bun';

export interface Project {
  root: string;
  /** Folder that holds the source, relative to the root. Default `src`. */
  sourceRoot: string;
  /** File the app starts from, relative to the root. Default `src/main.ts`. */
  entry: string;
  /** What runs the built app in production. Default `node`. */
  runtime: Runtime;
  /** `.js` when the project writes relative imports with an extension, otherwise empty. */
  importExtension: '' | '.js';
  dependencies: Record<string, string>;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  suku?: { sourceRoot?: string; entry?: string; runtime?: string };
}

/** Reads the project in `cwd`. Settings come from the `suku` field of its `package.json`. */
export function loadProject(cwd: string): Project {
  const file = join(cwd, 'package.json');
  if (!existsSync(file)) {
    throw new CliError(
      'No package.json here. Run this from the root of a Suku project, or create one with `suku new <name>`.',
    );
  }
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
  } catch {
    throw new CliError('package.json is not valid JSON.');
  }
  const settings = pkg.suku ?? {};
  const sourceRoot = settings.sourceRoot ?? 'src';
  const entry = settings.entry ?? `${sourceRoot}/main.ts`;
  const runtime = settings.runtime ?? 'node';
  if (runtime !== 'node' && runtime !== 'bun') {
    throw new CliError(`"suku.runtime" in package.json must be "node" or "bun", not "${runtime}".`);
  }
  return {
    root: cwd,
    sourceRoot,
    entry,
    runtime,
    importExtension: detectExtension(join(cwd, entry)),
    dependencies: { ...pkg.dependencies, ...pkg.devDependencies },
  };
}

function detectExtension(entryFile: string): '' | '.js' {
  if (!existsSync(entryFile)) return '';
  return /from\s+['"]\.{1,2}\/[^'"]+\.js['"]/.test(readFileSync(entryFile, 'utf8')) ? '.js' : '';
}

/** The specifier to import `to` from `from`, both relative to the project root, without `.ts`. */
export function importPath(from: string, to: string, extension: string): string {
  const path = relative(dirname(from), to).split('\\').join('/').replace(/\.ts$/, '');
  return `${path.startsWith('.') ? path : `./${path}`}${extension}`;
}
