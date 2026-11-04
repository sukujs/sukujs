import { InjectionToken, value } from '@suku/di';
import { defineModule, type ModuleDefinition } from './module.js';
import {
  flattenIssues,
  type InferOutput,
  type SchemaIssue,
  type StandardSchema,
} from './schema.js';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  constructor(
    name: string,
    readonly issues: readonly SchemaIssue[],
  ) {
    const lines = flattenIssues(issues).map((i) => `  - ${i.path || '(root)'}: ${i.message}`);
    super(`Invalid configuration "${name}":\n${lines.join('\n')}`);
  }
}

/**
 * A typed injection token for validated configuration. `load()` validates a source (by
 * default the process environment) at startup and returns a module that provides the value.
 *
 * ```ts
 * export const Env = defineConfig('env', z.object({ PORT: z.coerce.number().default(3000) }));
 *
 * Suku.create({ imports: [Env.load()] });
 *
 * class Server { constructor(@Inject(Env) private env: Infer<typeof Env.schema>) {} }
 * ```
 */
export class ConfigToken<S extends StandardSchema> extends InjectionToken<InferOutput<S>> {
  constructor(
    name: string,
    readonly schema: S,
  ) {
    super(name);
  }

  /** Validates `source` and returns a module providing the result. Rejects with `ConfigError`. */
  async load(source: Record<string, unknown> = defaultSource()): Promise<ModuleDefinition> {
    const result = await this.schema['~standard'].validate(source);
    if (result.issues) throw new ConfigError(this.description, result.issues);
    return defineModule({
      name: `config:${this.description}`,
      services: [value(this, result.value)],
    });
  }

  /** Validates `source` synchronously-ish and returns the value, for use outside DI. */
  async parse(source: Record<string, unknown> = defaultSource()): Promise<InferOutput<S>> {
    const result = await this.schema['~standard'].validate(source);
    if (result.issues) throw new ConfigError(this.description, result.issues);
    return result.value as InferOutput<S>;
  }
}

function defaultSource(): Record<string, unknown> {
  const p = (globalThis as { process?: { env?: Record<string, unknown> } }).process;
  return { ...(p?.env ?? {}) };
}

export function defineConfig<S extends StandardSchema>(name: string, schema: S): ConfigToken<S> {
  return new ConfigToken(name, schema);
}
