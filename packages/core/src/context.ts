import type { ServiceProvider } from '@suku/di';
import { type BodyOptions, parseBody } from './body.js';

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

  constructor(
    readonly request: Request,
    /** Raw route parameters, decoded. Empty for unmatched requests. */
    readonly params: Readonly<Record<string, string>>,
    /** The request's DI scope. Disposed when the response has been produced. */
    readonly provider: ServiceProvider,
    /** Undefined when no route matched. */
    readonly route: RouteInfo | undefined,
    readonly settings: RequestSettings = DEFAULT_SETTINGS,
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

  /** Per-request state shared by middlewares and handlers (e.g. the current user). */
  set<T>(key: unknown, value: T): void {
    (this.state ??= new Map()).set(key, value);
  }

  get<T = unknown>(key: unknown): T | undefined {
    return this.state?.get(key) as T | undefined;
  }
}
