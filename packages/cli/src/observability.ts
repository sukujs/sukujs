import { CliError } from './errors';
import { addImport, prependToArray } from './register';

/**
 * Reads `--observability`. There is one kind: the `@sukujs/observability` middleware, which
 * sends OpenTelemetry to any OTLP endpoint. Returns whether it was asked for.
 */
export function parseObservability(value: string): boolean {
  if (value === 'none') return false;
  if (value === 'opentelemetry' || value === 'otel') return true;
  throw new CliError(
    `Unknown observability option "${value}". Use opentelemetry (or otel), or none.`,
  );
}

/** What the wiring needs from a project, whether it exists on disk or is still being created. */
export interface ObservabilityTarget {
  /** Folder that holds the source, relative to the root. */
  sourceRoot: string;
  /** File the app starts from, relative to the root. */
  entry: string;
  read(path: string): string | undefined;
  update(path: string, content: string): void;
  note(message: string): void;
}

const PACKAGE = '@sukujs/observability';
/** A header a client can send to have one request traced for certain. */
const MIDDLEWARE = "observability({ forceTraceHeader: 'x-app-trace' })";

function envLines(name: string): string[] {
  return [
    '# Where traces, logs and errors are sent: any OTLP endpoint, a collector or a vendor.',
    'OTLP_ENDPOINT=http://localhost:4318',
    '# The API key for that endpoint, as name=value. Leave it out if the endpoint needs none.',
    '# OTLP_HEADER=name=value',
    `OTEL_SERVICE_NAME=${name}`,
  ];
}

/** Added to the project's config, so a missing endpoint stops the app before it listens. */
const CONFIG_FIELDS = [
  '// Where traces, logs and errors are sent. Any OTLP endpoint: a collector or a vendor.',
  'OTLP_ENDPOINT: z.url(),',
  '// The API key for that endpoint, as name=value. Not every endpoint needs one.',
  'OTLP_HEADER: z.string().optional(),',
];

/**
 * Adds `@sukujs/observability` to a project and wires it in: the dependency, the middleware
 * first in the entry file, the endpoint as a required config value, and one line in the
 * logger that ships its lines. Whatever cannot
 * be edited safely becomes a note that tells the user what to add.
 */
export function addObservability(target: ObservabilityTarget): void {
  const { sourceRoot, entry } = target;
  const pkg = target.read('package.json');
  const json = pkg === undefined ? undefined : (JSON.parse(pkg) as PackageJson);
  const name = json?.name ?? 'app';

  if (json !== undefined) {
    const dependencies = {
      ...json.dependencies,
      // The same version as the rest of Suku: every package is released together.
      [PACKAGE]: json.dependencies?.['@sukujs/core'] ?? 'latest',
      // A peer of the package, and what the logger reads trace ids through.
      '@opentelemetry/api': json.dependencies?.['@opentelemetry/api'] ?? '^1.9.0',
    };
    json.dependencies = Object.fromEntries(
      Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
    );
    target.update('package.json', `${JSON.stringify(json, null, 2)}\n`);
  }

  const env = target.read('.env.example');
  if (env !== undefined && !/^#?\s*OTLP_ENDPOINT=/m.test(env)) {
    target.update('.env.example', `${env.trimEnd()}\n${envLines(name).join('\n')}\n`);
  }

  const configPath = `${sourceRoot}/config.ts`;
  const config = target.read(configPath);
  if (config === undefined || !config.includes('OTLP_ENDPOINT')) {
    // The end of the schema passed to defineConfig: `  }),\n);`
    const end = config === undefined ? null : /\n([ \t]*)\}\),\n\);/.exec(config);
    if (config === undefined || !end) {
      target.note(
        'Add `OTLP_ENDPOINT: z.url()` to your config schema, so the app refuses to start without it.',
      );
    } else {
      const fields = CONFIG_FIELDS.map((line) => `\n${end[1]}  ${line}`).join('');
      target.update(configPath, `${config.slice(0, end.index)}${fields}${config.slice(end.index)}`);
    }
  }

  const main = target.read(entry);
  if (main === undefined || main.includes('observability(')) {
    if (main === undefined) {
      target.note(`Add \`${MIDDLEWARE}\` as the first of your app's \`middlewares\`.`);
    }
  } else {
    const listed = prependToArray(main, 'middlewares', MIDDLEWARE);
    if (listed === undefined) {
      target.note(
        `Add \`${MIDDLEWARE}\` as the first of the \`middlewares\` of Suku.create() in ${entry}, and import it from '${PACKAGE}'.`,
      );
    } else {
      target.update(entry, addImport(listed, 'observability', PACKAGE));
    }
  }

  const loggerPath = `${sourceRoot}/logger.ts`;
  const logger = target.read(loggerPath);
  if (logger?.includes('telemetry.log(')) {
    // Already shipping its lines. Make sure `telemetry` comes from the package.
    const imported = addImport(logger, 'telemetry', PACKAGE);
    if (imported !== logger) target.update(loggerPath, imported);
    return;
  }
  const shipped = logger
    ?.replace(
      /^([ \t]*)this\.pino\[level\]\(meta \?\? \{\}, message\);$/m,
      (line, indent: string) => `${line}\n${indent}telemetry.log(level, message, meta);`,
    )
    .replace(
      /^([ \t]*)this\.pino\.error\(\{ \.\.\.meta, err: message \}, message\.message\);$/m,
      (line, indent: string) => `${line}\n${indent}telemetry.log('error', message.message, meta);`,
    );
  if (shipped === undefined || shipped === logger) {
    target.note(
      `To send logs as well, call \`telemetry.log(level, message, meta)\` from your Logger. Import \`telemetry\` from '${PACKAGE}'.`,
    );
  } else {
    target.update(loggerPath, addImport(shipped, 'telemetry', PACKAGE));
  }
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
}
