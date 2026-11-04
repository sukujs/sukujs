export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * The framework's logger, injectable anywhere. A `ConsoleLogger` is registered by default;
 * replace it with `singleton(Logger, PinoLogger)` in any module.
 */
export abstract class Logger {
  abstract log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }
  error(message: string | unknown, meta?: Record<string, unknown>): void {
    if (message instanceof Error) {
      this.log('error', message.message, { ...meta, stack: message.stack, cause: message.cause });
    } else {
      this.log('error', String(message), meta);
    }
  }
}

export class ConsoleLogger extends Logger {
  /** Minimum level written. Entries below it are dropped. */
  level: LogLevel = 'info';

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (ORDER[level] < ORDER[this.level]) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
    const fn =
      level === 'debug'
        ? console.debug
        : level === 'info'
          ? console.info
          : level === 'warn'
            ? console.warn
            : console.error;
    if (meta && Object.keys(meta).length) fn(line, meta);
    else fn(line);
  }
}

/** Discards everything. Handy in tests. */
export class SilentLogger extends Logger {
  log(): void {}
}
