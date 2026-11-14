import { spawn, spawnSync } from 'node:child_process';
import { CliError } from './errors.js';

/** Runs a command with the terminal attached and resolves with its exit code. */
export function exec(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    });
    // The child shares the terminal, so it receives Ctrl+C itself. Wait for it to finish.
    const ignore = () => {};
    process.on('SIGINT', ignore);
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    child.on('error', (error: NodeJS.ErrnoException) => {
      process.off('SIGINT', ignore);
      reject(
        error.code === 'ENOENT'
          ? new CliError(
              command === 'bun'
                ? 'Bun is required for this command and was not found. Install it from https://bun.sh.'
                : `Could not find \`${command}\` on your PATH.`,
            )
          : error,
      );
    });
    child.on('exit', (code, signal) => {
      process.off('SIGINT', ignore);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

/** The version a tool reports, or `undefined` when it is not installed. */
export function versionOf(command: string): string | undefined {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout.trim().split('\n')[0];
}
