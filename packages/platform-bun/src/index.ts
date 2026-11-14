import type { FetchHandler, HttpServer, PlatformAdapter, ServeOptions } from '@sukujs/core';

export interface BunAdapterOptions {
  /** Called when the handler throws. Default logs to `console.error` and answers 500. */
  onError?: (error: unknown) => Response | Promise<Response>;
}

export function bunAdapter(options: BunAdapterOptions = {}): PlatformAdapter {
  return {
    name: 'bun',
    async serve(handler: FetchHandler, serve: ServeOptions = {}): Promise<HttpServer> {
      const { port = 3000, hostname = '0.0.0.0' } = serve;
      const server = Bun.serve({
        port,
        hostname,
        development: false,
        fetch: (request, server) => {
          const address = server.requestIP(request)?.address;
          return handler(request, address === undefined ? undefined : { remoteAddress: address });
        },
        error:
          options.onError ??
          ((error) => {
            console.error(error);
            return new Response('Internal Server Error', { status: 500 });
          }),
      });
      const host = server.hostname?.includes(':') ? `[${server.hostname}]` : server.hostname;
      return {
        hostname: server.hostname ?? hostname,
        port: server.port ?? port,
        url: `http://${host}:${server.port}`,
        close: async ({ force = false } = {}) => {
          await server.stop(force);
        },
      };
    },
  };
}
