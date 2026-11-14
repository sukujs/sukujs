import type { ServiceProvider } from '@suku/di';
import { type BodyOptions, parseBody } from './body.js';
import { Cookies } from './cookies.js';

export interface RouteInfo {
  readonly method: string;
  /** Full path pattern, e.g. `/users/:id`. */
  readonly path: string;
  /** `UsersRoutes.findOne`, a group key, or the route's `name`. */
  readonly name: string;
  /** The route's `meta` option. */
  readonly meta: Readonly<Record<string, unknown>>;
}

export interface RequestSettings {
  /** Options for `ctx.body()`, from `Suku.create({ bodyLimit })`. */
  readonly body: BodyOptions;
}

const DEFAULT_SETTINGS: RequestSettings = { body: {} };

/**
 * Everything about the request in flight. Passed to middlewares and handlers, and injectable
 * into scoped and transient services. One instance per request.
 */
export class RequestContext {
  private parsedUrl: URL | undefined;
  private parsedQuery: Record<string, string | string[]> | undefined;
  private state: Map<unknown, unknown> | undefined;
  private parsedBody: Promise<unknown> | undefined;
  private cookieJar: Cookies | undefined;
  private pendingHeaders: Headers | undefined;

  constructor(
    readonly request: Request,
    /** Raw route parameters, decoded. Empty for unmatched requests. */
    readonly params: Readonly<Record<string, string>>,
    /** The request's DI scope. Disposed when the response has been produced. */
    readonly provider: ServiceProvider,
    /** Undefined when no route matched. */
    readonly route: RouteInfo | undefined,
    readonly settings: RequestSettings = DEFAULT_SETTINGS,
    /**
     * The peer's IP address from the platform adapter. Behind a reverse proxy this is the
     * proxy's address; `undefined` when the request did not come through a socket (tests).
     */
    readonly remoteAddress?: string,
  ) {}

  get method(): string {
    return this.request.method;
  }

  /** Parsed lazily; most handlers never need it. */
  get url(): URL {
    return (this.parsedUrl ??= new URL(this.request.url));
  }

  get headers(): Headers {
    return this.request.headers;
  }

  /** The query string as an object. Repeated keys become arrays. */
  get query(): Record<string, string | string[]> {
    if (this.parsedQuery) return this.parsedQuery;
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of this.url.searchParams) {
      const existing = out[k];
      if (existing === undefined) out[k] = v;
      else if (Array.isArray(existing)) existing.push(v);
      else out[k] = [existing, v];
    }
    this.parsedQuery = out;
    return out;
  }

  /**
   * The parsed request body (JSON, form, multipart, text or bytes by content type), read
   * once and cached, so middlewares and the handler share one parse.
   */
  body<T = unknown>(): Promise<T> {
    return (this.parsedBody ??= parseBody(this.request, this.settings.body)) as Promise<T>;
  }

  /**
   * Cookies: `get` reads what the client sent, `set` and `delete` are applied to the
   * response, whatever it turns out to be.
   */
  get cookies(): Cookies {
    return (this.cookieJar ??= new Cookies(
      this.request.headers.get('cookie'),
      () => this.responseHeaders,
    ));
  }

  /**
   * Headers to add to the response. Useful when a handler returns plain data and still
   * needs a header. A header set on a returned `Response` takes precedence.
   */
  get responseHeaders(): Headers {
    return (this.pendingHeaders ??= new Headers());
  }

  /** Sets a response header. Shorthand for `ctx.responseHeaders.set`. */
  setHeader(name: string, value: string): this {
    this.responseHeaders.set(name, value);
    return this;
  }

  /** @internal Applies cookies and headers collected during the request. */
  finalize(response: Response): Response {
    const pending = this.pendingHeaders;
    if (!pending) return response;
    let out = response;
    try {
      out.headers.append('x-suku-probe', '1');
      out.headers.delete('x-suku-probe');
    } catch {
      // Headers of fetch() results and Response.redirect() are immutable: copy.
      out = new Response(response.body, response);
    }
    for (const [name, value] of pending) {
      if (name === 'set-cookie') continue;
      if (!out.headers.has(name)) out.headers.set(name, value);
    }
    for (const cookie of pending.getSetCookie()) out.headers.append('set-cookie', cookie);
    return out;
  }

  /** Per-request state shared by middlewares and handlers (e.g. the current user). */
  set<T>(key: unknown, value: T): void {
    (this.state ??= new Map()).set(key, value);
  }

  get<T = unknown>(key: unknown): T | undefined {
    return this.state?.get(key) as T | undefined;
  }
}
