import { type Infer, Inject, Logger, type LogLevel, middleware, Service } from '@sukujs/core';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import pino from 'pino';
import pretty from 'pino-pretty';
import { Env } from './config';

/**
 * The ids of the OpenTelemetry span that is active right now, under the field names
 * OpenTelemetry tools expect. Empty until the app runs with an OpenTelemetry SDK.
 */
export function traceContext(): Record<string, string> {
  const span = trace.getActiveSpan()?.spanContext();
  if (!span || !isSpanContextValid(span)) return {};
  return {
    trace_id: span.traceId,
    span_id: span.spanId,
    trace_flags: `0${span.traceFlags.toString(16)}`,
  };
}

/**
 * Suku's `Logger`, written with pino. In a terminal the lines are made for reading. Anywhere
 * else (a container, a pipe, a log file) each line is one JSON object, which is what log
 * collectors expect. `LOG_FORMAT` overrides the choice.
 */
@Service()
export class PinoLogger extends Logger {
  readonly pino: pino.Logger;

  constructor(@Inject(Env) env: Infer<typeof Env.schema>) {
    super();
    // `mixin` runs for every line, so each one gets the trace it was written in.
    const format = env.LOG_FORMAT ?? (process.stdout.isTTY ? 'pretty' : 'json');
    this.pino = pino(
      { level: env.LOG_LEVEL, mixin: traceContext },
      // https://github.com/pinojs/pino-pretty#options
      format === 'pretty'
        ? pretty({
            singleLine: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            sync: true,
          })
        : undefined,
    );
  }

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    this.pino[level](meta ?? {}, message);
  }

  /** Hands an `Error` to pino itself, which records its type, message, stack and cause. */
  override error(message: unknown, meta?: Record<string, unknown>): void {
    if (message instanceof Error) {
      this.pino.error({ ...meta, err: message }, message.message);
    } else {
      super.error(message, meta);
    }
  }
}

/** One line per request: method, path, status and how long it took. */
export const requestLogger = middleware(async (ctx, next) => {
  const started = performance.now();
  const response = await next();
  ctx.provider.get(Logger).info('request', {
    method: ctx.method,
    path: ctx.url.pathname,
    status: response.status,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
});
