/** What a UI needs to know to render its page. */
export interface DocsPage {
  /** Where the browser fetches the OpenAPI document. */
  specUrl: string;
  title: string;
  /** Put this on every inline `<script>`; the page's Content-Security-Policy allows nothing else inline. */
  nonce: string;
}

/**
 * A page that renders an OpenAPI document. `swaggerUi()`, `scalar()` and `redoc()` are built
 * in; any other viewer is an object of this shape.
 */
export interface DocsUi {
  /** Origins the page loads scripts, styles, fonts and images from, for its Content-Security-Policy. */
  sources: string[];
  /** Further origins the page may call, besides the API itself. */
  connect?: string[];
  render(page: DocsPage): string;
}

export interface CdnOptions {
  /** Version of the UI package. Pinned by default so the page does not change under you. */
  version?: string;
  /** Base URL of the package's files, to self-host them or use another CDN. */
  cdn?: string;
}

const JSDELIVR = 'https://cdn.jsdelivr.net';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** JSON that is safe inside a `<script>` element. */
const inline = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

const originOf = (url: string) => (url.startsWith('/') ? "'self'" : new URL(url).origin);

const page = (title: string, head: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    ${head}
  </head>
  <body>
    ${body}
  </body>
</html>
`;

export interface SwaggerUiOptions extends CdnOptions {
  /** Passed to `SwaggerUIBundle`, e.g. `{ persistAuthorization: true }`. Must be JSON. */
  options?: Record<string, unknown>;
}

/** [Swagger UI](https://swagger.io/tools/swagger-ui/). */
export function swaggerUi(options: SwaggerUiOptions = {}): DocsUi {
  const cdn = options.cdn ?? `${JSDELIVR}/npm/swagger-ui-dist@${options.version ?? '5.35.0'}`;
  return {
    sources: [originOf(cdn)],
    render: ({ specUrl, title, nonce }) =>
      page(
        title,
        `<link rel="stylesheet" href="${cdn}/swagger-ui.css" />`,
        `<div id="swagger-ui"></div>
    <script src="${cdn}/swagger-ui-bundle.js" nonce="${nonce}"></script>
    <script nonce="${nonce}">
      window.ui = SwaggerUIBundle(Object.assign(${inline({ deepLinking: true, ...options.options, url: specUrl })}, { dom_id: '#swagger-ui' }));
    </script>`,
      ),
  };
}

export interface ScalarOptions extends CdnOptions {
  /** Scalar's configuration, e.g. `{ theme: 'purple', layout: 'classic' }`. Must be JSON. */
  configuration?: Record<string, unknown>;
}

/** [Scalar](https://scalar.com) API reference. */
export function scalar(options: ScalarOptions = {}): DocsUi {
  const cdn = options.cdn ?? `${JSDELIVR}/npm/@scalar/api-reference@${options.version ?? '1.80.0'}`;
  return {
    sources: [originOf(cdn), 'https://fonts.scalar.com'],
    connect: ['https://proxy.scalar.com'],
    render: ({ specUrl, title, nonce }) =>
      page(
        title,
        '',
        `<div id="app"></div>
    <script src="${cdn}/dist/browser/standalone.js" nonce="${nonce}"></script>
    <script nonce="${nonce}">
      Scalar.createApiReference('#app', ${inline({ ...options.configuration, url: specUrl })});
    </script>`,
      ),
  };
}

export interface RedocOptions extends CdnOptions {
  /** Redoc's options, e.g. `{ hideDownloadButton: true }`. Must be JSON. */
  options?: Record<string, unknown>;
}

/** [Redoc](https://redocly.com/redoc). Read-only: it has no "try it" console. */
export function redoc(options: RedocOptions = {}): DocsUi {
  const cdn = options.cdn ?? `${JSDELIVR}/npm/redoc@${options.version ?? '2.5.4'}`;
  return {
    sources: [originOf(cdn), 'https://cdn.redoc.ly'],
    render: ({ specUrl, title, nonce }) =>
      page(
        title,
        '<style>body { margin: 0; }</style>',
        `<div id="redoc"></div>
    <script src="${cdn}/bundles/redoc.standalone.js" nonce="${nonce}"></script>
    <script nonce="${nonce}">
      Redoc.init(${inline(specUrl)}, ${inline(options.options ?? {})}, document.getElementById('redoc'));
    </script>`,
      ),
  };
}

/** The policy for a docs page: its own inline scripts, its UI's CDN, and calls to the API. */
export function docsCsp(ui: DocsUi, nonce: string): string {
  const sources = [...new Set(ui.sources)].join(' ');
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${sources}`,
    `style-src 'unsafe-inline' ${sources}`,
    `img-src 'self' data: blob: ${sources}`,
    `font-src data: ${sources}`,
    `connect-src ${["'self'", ...ui.sources, ...(ui.connect ?? [])].filter((s, i, a) => a.indexOf(s) === i).join(' ')}`,
    'worker-src blob:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
