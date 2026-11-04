import type { ArgumentMetadata, Pipe } from './enhancers.js';
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

function describeArgument(m: ArgumentMetadata): string {
  return m.data === undefined
    ? m.kind.toLowerCase()
    : `${m.kind.toLowerCase()} "${String(m.data)}"`;
}

/**
 * Validates a handler argument with a Standard Schema. Param decorators accept a schema
 * directly (`@Body(CreateUser)`, `@Query(ListQuery)`, `@Param('id', Id)`), which creates
 * this pipe for you.
 */
export class ValidationPipe<S extends StandardSchema = StandardSchema>
  implements Pipe<unknown, InferOutput<S>>
{
  constructor(readonly schema: S) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<InferOutput<S>> {
    return validate(this.schema, value, describeArgument(metadata));
  }
}
