import type { Constructor, ServiceProvider } from '@suku/di';
import { type BodyOptions, parseBody } from './body.js';

export interface RouteInfo {
  readonly method: string;
  readonly path: string;
  readonly controller: Constructor;
  readonly handler: string | symbol;
}

/**
 * Everything about the request in flight. Injectable into scoped and transient services,
 * and passed to guards, interceptors, pipes and filters. One instance per request.
 */
export interface RequestSettings {
  /** Options for `ctx.body()`, from `Suku.create({ bodyLimit })`. */
  readonly body: BodyOptions;
}

const DEFAULT_SETTINGS: RequestSettings = { body: {} };

export class RequestContext {
  private parsedUrl: URL | undefined;
  private state: Map<unknown, unknown> | undefined;
  private parsedBody: Promise<unknown> | undefined;

  constructor(
    readonly request: Request,
    /** Route parameters, decoded. Empty object for unmatched requests. */
    readonly params: Readonly<Record<string, string>>,
    /** The request's DI scope. Disposed when the response has been produced. */
    readonly provider: ServiceProvider,
    /** Undefined when no route matched. */
    readonly route: RouteInfo | undefined,
    private readonly routeMetadata?: ReadonlyMap<unknown, unknown>,
    readonly settings: RequestSettings = DEFAULT_SETTINGS,
  ) {}

  /**
   * The parsed request body (JSON, form, multipart, text or bytes by content type), read
   * once and cached. `@Body()` uses this, so middleware and handlers can share one parse.
   */
  body<T = unknown>(): Promise<T> {
    return (this.parsedBody ??= parseBody(this.request, this.settings.body)) as Promise<T>;
  }

  /** Reads a value attached with `@SetMetadata`; method-level values override class-level. */
  getMetadata<T = unknown>(key: unknown): T | undefined {
    return this.routeMetadata?.get(key) as T | undefined;
  }

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

  /** Per-request state bag shared by middleware, guards and handlers (e.g. the current user). */
  set<T>(key: unknown, value: T): void {
    (this.state ??= new Map()).set(key, value);
  }

  get<T = unknown>(key: unknown): T | undefined {
    return this.state?.get(key) as T | undefined;
  }
}
