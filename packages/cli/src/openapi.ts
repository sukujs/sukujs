import { CliError } from './errors';
import { addArrayToFeature, addImport, addToArray } from './register';

/** The pages that can render the document. Each is a function of `@sukujs/openapi`. */
export const OPENAPI_UIS = {
  swagger: { label: 'Swagger UI', hint: 'the classic, with a request console', call: 'swaggerUi' },
  scalar: { label: 'Scalar', hint: 'modern reference with a request client', call: 'scalar' },
  redoc: { label: 'Redoc', hint: 'three-column reference, read-only', call: 'redoc' },
} as const;

export type OpenApiUi = keyof typeof OPENAPI_UIS;

/** Reads `--openapi`: the UI to serve the document with, or `undefined` for `none`. */
export function parseOpenApi(value: string): OpenApiUi | undefined {
  if (value === 'none') return undefined;
  if (value === 'swagger-ui') return 'swagger';
  if (value in OPENAPI_UIS) return value as OpenApiUi;
  throw new CliError(`Unknown OpenAPI UI "${value}". Use swagger, scalar, redoc, or none.`);
}

/** What the wiring needs from a project, whether it exists on disk or is still being created. */
export interface OpenApiTarget {
  /** Folder that holds the source, relative to the root. */
  sourceRoot: string;
  /** File the app starts from, relative to the root. */
  entry: string;
  read(path: string): string | undefined;
  update(path: string, content: string): void;
  note(message: string): void;
}

const PACKAGE = '@sukujs/openapi';

/**
 * Adds `@sukujs/openapi` to a project: the dependency, and the `openapi()` route in the root
 * feature, so every entry point of the app serves the document and its UI. Without a root
 * feature it goes in the entry file's `routes`. What cannot be edited safely becomes a note.
 */
export function addOpenApi(target: OpenApiTarget, ui: OpenApiUi): void {
  const pkg = target.read('package.json');
  const json = pkg === undefined ? undefined : (JSON.parse(pkg) as PackageJson);
  if (json !== undefined) {
    const dependencies = {
      ...json.dependencies,
      // The same version as the rest of Suku: every package is released together.
      [PACKAGE]: json.dependencies?.['@sukujs/core'] ?? 'latest',
    };
    json.dependencies = Object.fromEntries(
      Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
    );
    target.update('package.json', `${JSON.stringify(json, null, 2)}\n`);
  }

  const { call } = OPENAPI_UIS[ui];
  // Swagger UI is the package's default, so it needs no `ui`.
  const names = ui === 'swagger' ? 'openapi' : `openapi, ${call}`;
  const title = (json?.name ?? 'API').replace(/['\\]/g, '');
  const item = `openapi({ info: { title: '${title}' }${ui === 'swagger' ? '' : `, ui: ${call}()`} })`;

  const featurePath = `${target.sourceRoot}/app.feature.ts`;
  const feature = target.read(featurePath);
  const path = feature === undefined ? target.entry : featurePath;
  const source = feature ?? target.read(target.entry);
  if (source?.includes('openapi(')) return;

  const listed =
    source === undefined
      ? undefined
      : (addToArray(source, 'routes', item) ??
        (feature === undefined ? undefined : addArrayToFeature(source, 'routes', item)));
  if (listed === undefined) {
    target.note(
      `Add \`${item}\` to the \`routes\` of Suku.create() in ${target.entry}, and import ${names} from '${PACKAGE}'.`,
    );
    return;
  }
  target.update(path, addImport(listed, names, PACKAGE));
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
}
