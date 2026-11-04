/**
 * The kernel speaks Fetch `Request` / `Response`. A platform adapter is the only piece
 * that knows about sockets: it turns the platform's native request into a `Request`,
 * calls the handler, and writes the `Response` back.
 */
export type FetchHandler = (request: Request) => Response | Promise<Response>;

export interface ServeOptions {
  /** Port to bind. `0` picks a free port. Default `3000`. */
  port?: number;
  /** Interface to bind. Default `0.0.0.0`. */
  hostname?: string;
}

export interface CloseOptions {
  /**
   * `false` (default): stop accepting connections, close idle keep-alive sockets, and
   * let in-flight requests finish. `true`: also drop in-flight connections.
   */
  force?: boolean;
}

export interface HttpServer {
  readonly hostname: string;
  readonly port: number;
  /** Origin such as `http://127.0.0.1:3000`. */
  readonly url: string;
  close(options?: CloseOptions): Promise<void>;
}

export interface PlatformAdapter {
  readonly name: string;
  serve(handler: FetchHandler, options?: ServeOptions): Promise<HttpServer>;
}
