/** A mistake in how the CLI was used. Printed without a stack trace, exit code 1. */
export class CliError extends Error {
  override readonly name = 'CliError';
}
