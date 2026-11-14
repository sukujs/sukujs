import { BadRequestException } from './http-errors.js';

/**
 * The Standard Schema interface (https://standardschema.dev), implemented by Zod, Valibot,
 * ArkType, Effect Schema and others. Suku validates through it and so depends on none of them.
 */
export interface StandardSchema<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => SchemaResult<Output> | Promise<SchemaResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

export type SchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly SchemaIssue[] };

export interface SchemaIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

export type InferInput<S extends StandardSchema> = NonNullable<S['~standard']['types']>['input'];
export type InferOutput<S extends StandardSchema> = NonNullable<S['~standard']['types']>['output'];
/** Shorthand for `InferOutput`. */
export type Infer<S extends StandardSchema> = InferOutput<S>;

export function isStandardSchema(value: unknown): value is StandardSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    '~standard' in value &&
    typeof (value as StandardSchema)['~standard']?.validate === 'function'
  );
}

/** A flattened issue as sent to clients: `path` is dot-joined, e.g. `address.street`. */
export interface ValidationIssue {
  path: string;
  message: string;
}

export function flattenIssues(issues: readonly SchemaIssue[]): ValidationIssue[] {
  return issues.map((i) => ({
    path: (i.path ?? []).map((p) => String(typeof p === 'object' ? p.key : p)).join('.'),
    message: i.message,
  }));
}

/** 400 with `{ statusCode, message, error, issues: [{ path, message }] }`. */
export class ValidationException extends BadRequestException {
  override readonly name = 'ValidationException';
  readonly issues: ValidationIssue[];

  constructor(issues: readonly SchemaIssue[], where?: string) {
    const flat = flattenIssues(issues);
    super({
      statusCode: 400,
      message: where ? `Validation failed for ${where}` : 'Validation failed',
      error: 'Bad Request',
      issues: flat,
    });
    this.issues = flat;
  }
}

/** Validates with a schema; returns the parsed value or throws `ValidationException`. */
export async function validate<S extends StandardSchema>(
  schema: S,
  value: unknown,
  where?: string,
): Promise<InferOutput<S>> {
  const result = await schema['~standard'].validate(value);
  if (result.issues) throw new ValidationException(result.issues, where);
  return result.value as InferOutput<S>;
}
