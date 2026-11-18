import { joinPaths, ROUTE_TABLE, type RouteGroup, route } from '@sukujs/core';
import {
  apiDoc,
  createOpenApiDocument,
  type OpenApiDocument,
  type OpenApiDocumentOptions,
  type SecuritySchemes,
} from './document';
import { type DocsUi, docsCsp, redoc, scalar, swaggerUi } from './ui';

export {
  type ApiDoc,
  type ApiResponse,
  apiDoc,
  createOpenApiDocument,
  type JsonObject,
  type OpenApiDocument,
  type OpenApiDocumentOptions,
  type OpenApiInfo,
  type OpenApiServer,
  type OpenApiTag,
  type OAuthFlows,
  type SecurityRequirement,
  type SecurityScheme,
  type SecuritySchemes,
} from './document';
export {
  type CdnOptions,
  type DocsPage,
  type DocsUi,
  docsCsp,
  type RedocOptions,
  redoc,
  type ScalarOptions,
  type SwaggerUiOptions,
  scalar,
  swaggerUi,
} from './ui';

export interface OpenApiOptions<S extends SecuritySchemes = {}> extends OpenApiDocumentOptions<S> {
  /** Where the document is served. Default `/openapi.json`. */
  path?: string;
  /** Where the UI is served. Default `/docs`. `false` serves the document only. */
  docs?: string | false;
  /** The page that renders the document. Default `swaggerUi()`. */
  ui?: DocsUi;
  /**
   * The document's URL as the browser sees it, when a proxy in front of the app changes the
   * path. Default: the document's own route.
   */
  specUrl?: string;
  /**
   * `Content-Security-Policy` of the UI page. The default allows the page's own scripts, its
   * UI's CDN and calls to this origin. Pass a string to replace it, or `false` to send none.
   */
  csp?: string | false;
}

/**
 * Routes that serve the app's OpenAPI document and a UI for it. Add the result to an app's
 * `routes`; the document is built from every route the app serves, on the first request.
 *
 * ```ts
 * Suku.create({
 *   features: [UsersFeature],
 *   routes: [openapi({ info: { title: 'Shop', version: '1.0.0' }, ui: scalar() })],
 * });
 * ```
 */
export function openapi<const S extends SecuritySchemes = {}>(
  options: OpenApiOptions<S> = {},
): RouteGroup {
  const path = options.path ?? '/openapi.json';
  const docs = options.docs ?? '/docs';
  const ui = options.ui ?? swaggerUi();
  const documents = new WeakMap<object, OpenApiDocument>();
  const meta = apiDoc({ hidden: true });

  const routes: Record<string, ReturnType<typeof route.get>> = {
    document: route.get(path, {
      name: 'openapi.document',
      meta,
      handle: ({ ctx }) => {
        const table = ctx.provider.root.get(ROUTE_TABLE);
        let document = documents.get(table);
        if (!document) documents.set(table, (document = createOpenApiDocument(table, options)));
        // "Try it" in the UI then calls the same origin the page came from.
        return document.servers ? document : { ...document, servers: [{ url: ctx.url.origin }] };
      },
    }),
  };

  if (docs !== false) {
    routes.ui = route.get(docs, {
      name: 'openapi.ui',
      meta,
      handle: ({ ctx }) => {
        // The app's own prefix is whatever precedes this route's path.
        const prefix = ctx.route!.path.slice(0, -joinPaths(docs).length);
        const nonce = crypto.randomUUID().replaceAll('-', '');
        const csp = options.csp ?? docsCsp(ui, nonce);
        return new Response(
          ui.render({
            specUrl: options.specUrl ?? joinPaths(prefix, path),
            title: options.info?.title ?? 'API',
            nonce,
          }),
          {
            headers: {
              'content-type': 'text/html; charset=utf-8',
              ...(csp ? { 'content-security-policy': csp } : {}),
            },
          },
        );
      },
    });
  }

  return route.group('', routes);
}

/** Everything in one object, for `import sukuOpenapi from '@sukujs/openapi'`. */
const sukuOpenapi = {
  openapi,
  apiDoc,
  createOpenApiDocument,
  swaggerUi,
  scalar,
  redoc,
} as const;

export default sukuOpenapi;
