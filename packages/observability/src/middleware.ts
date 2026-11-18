import { HttpException, type Middleware, type Next, type RequestContext } from '@sukujs/core';
import { start } from './init';
import { telemetry, traceRequest } from './telemetry';
import type { ObservabilityOptions } from './types';

/**
 * Sends request traces, logs, errors and runtime metrics to any OpenTelemetry (OTLP)
 * endpoint. Put it first in `middlewares`, so everything else happens inside the trace:
 *
 * ```ts
 * const app = await Suku.create({
 *   middlewares: [observability(), requestLogger],
 * });
 * ```
 *
 * With no arguments it reads `OTLP_ENDPOINT` and `OTLP_HEADER`, and it stays off until the
 * endpoint is set. What it does per request:
 *
 * - runs the request in a trace named after its route, `GET /users/:id`, continuing the
 *   caller's trace when there is one
 * - reports the error the request ended with, unless it is an `HttpException`, which is an
 *   answer the app chose to give
 *
 * It is created by the container, so closing the app disposes it, which sends whatever is
 * still waiting.
 */
export function observability(options: ObservabilityOptions = {}): new () => Middleware {
  start(options);
  return class Observability implements Middleware {
    use(ctx: RequestContext, next: Next): Promise<Response> {
      const route = ctx.route?.path;
      return traceRequest(
        { method: ctx.method, route, header: (name) => ctx.headers.get(name) },
        async () => {
          const response = await next();
          const { error } = ctx;
          if (error !== undefined && !(error instanceof HttpException)) {
            telemetry.captureException(error, { method: ctx.method, route });
          }
          return response;
        },
      );
    }

    dispose(): Promise<void> {
      return telemetry.flush();
    }
  };
}
