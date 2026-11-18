import { isStandardSchema, type RegisteredRoute, type StandardSchema } from '@sukujs/core';

export type JsonObject = Record<string, unknown>;

/** Vendor extensions: any key that starts with `x-`. */
type Extensions = { [extension: `x-${string}`]: unknown };

/**
 * Which schemes a request must satisfy: `{ bearer: [] }`. The array lists OAuth scopes and is
 * empty for other schemes. `Name` is the union of declared scheme names.
 */
export type SecurityRequirement<Name extends string = string> = [Name] extends [never]
  ? // No scheme is declared, so none can be required.
    Record<string, never>
  : { [K in Name]?: string[] };

interface OAuthFlow {
  /** Scope name to a short description. */
  scopes: Record<string, string>;
  refreshUrl?: string;
}

export interface OAuthFlows {
  implicit?: OAuthFlow & { authorizationUrl: string };
  password?: OAuthFlow & { tokenUrl: string };
  clientCredentials?: OAuthFlow & { tokenUrl: string };
  authorizationCode?: OAuthFlow & { authorizationUrl: string; tokenUrl: string };
}

/** How clients authenticate. One of the kinds OpenAPI 3.1 defines. */
export type SecurityScheme = (
  | {
      type: 'http';
      scheme: 'bearer';
      /** A hint for readers, such as `JWT`. */ bearerFormat?: string;
    }
  | { type: 'http'; scheme: 'basic' | 'digest'; bearerFormat?: never }
  | {
      type: 'apiKey';
      in: 'header' | 'query' | 'cookie';
      /** The header, query or cookie name. */ name: string;
    }
  | { type: 'oauth2'; flows: OAuthFlows }
  | { type: 'openIdConnect'; openIdConnectUrl: string }
  | { type: 'mutualTLS' }
) & { description?: string } & Extensions;

export type SecuritySchemes = Record<string, SecurityScheme>;

/** A documented response other than the success one. */
export interface ApiResponse {
  description: string;
  /** Shape of the body: a Standard Schema, or a JSON Schema object written by hand. */
  schema?: StandardSchema<any, any> | JsonObject;
  /** Default `application/json`. */
  contentType?: string;
}

/** What a route says about itself, beyond what its schemas already tell. */
export interface ApiDoc<Scheme extends string = string> {
  summary?: string;
  description?: string;
  /** Groups the operation in the UI. Default: the name of the feature that declares the route. */
  tags?: string[];
  /** Default: the route's name, e.g. `UsersRoutes_findOne`. */
  operationId?: string;
  deprecated?: boolean;
  /** Leave the route out of the document. */
  hidden?: boolean;
  /** Replaces the document's default `security` for this route. `[]` marks it as public. */
  security?: SecurityRequirement<Scheme>[];
  /**
   * Extra responses by status. A string is a description and documents Suku's error body,
   * `{ statusCode, message, error }`.
   */
  responses?: Record<number, string | ApiResponse>;
}

/**
 * Documents a route. Spread the result into the route's `meta`; it changes nothing about how
 * the route behaves.
 *
 * ```ts
 * findOne = route.get('/:id', {
 *   meta: apiDoc({ summary: 'Get a user', responses: { 404: 'No user with this id' } }),
 *   params: z.object({ id: z.coerce.number() }),
 *   response: User,
 *   handle: ({ params }) => this.users.find(params.id),
 * });
 * ```
 *
 * To have scheme names in `security` checked, pass them: `apiDoc<'bearer'>({ ... })`.
 */
export function apiDoc<Scheme extends string = string>(
  doc: ApiDoc<Scheme>,
): { openapi: ApiDoc<Scheme> } {
  return { openapi: doc };
}

export interface OpenApiInfo extends Extensions {
  title: string;
  version: string;
  summary?: string;
  description?: string;
  termsOfService?: string;
  contact?: { name?: string; url?: string; email?: string };
  license?: { name: string; identifier?: string; url?: string };
}

export interface OpenApiServer extends Extensions {
  url: string;
  description?: string;
  /** Values for `{placeholders}` in `url`. */
  variables?: Record<string, { default: string; enum?: string[]; description?: string }>;
}

export interface OpenApiTag extends Extensions {
  name: string;
  description?: string;
  externalDocs?: { url: string; description?: string };
}

/** One operation of the document, as the `operation` hook receives it. */
export interface OpenApiOperation {
  operationId: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated?: boolean;
  parameters?: JsonObject[];
  requestBody?: JsonObject;
  /** By status code. */
  responses: Record<string, JsonObject>;
  security?: SecurityRequirement[];
  /** Anything else OpenAPI allows on an operation, such as `x-` extensions. */
  [key: string]: unknown;
}

export interface OpenApiDocument {
  openapi: string;
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  tags?: OpenApiTag[];
  security?: SecurityRequirement[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * `S` is the type of `securitySchemes`. It is inferred, and `security` then only accepts the
 * names declared there.
 */
export interface OpenApiDocumentOptions<S extends SecuritySchemes = {}> {
  /** Default `{ title: 'API', version: '0.0.0' }`. */
  info?: Partial<OpenApiInfo>;
  /** Where the API is reachable. The served document defaults to the origin of the request. */
  servers?: OpenApiServer[];
  /** Descriptions for tags, and their order in the UI. */
  tags?: OpenApiTag[];
  /** `components.securitySchemes`, e.g. `{ bearer: { type: 'http', scheme: 'bearer' } }`. */
  securitySchemes?: S;
  /** Security applied to every route that does not set its own. Keys are scheme names. */
  security?: SecurityRequirement<keyof NoInfer<S> & string>[];
  /**
   * Turns a route's schema into JSON Schema. The default asks the schema itself, through the
   * Standard JSON Schema interface (Zod 4.2+, ArkType, Valibot with its converter). Return
   * `undefined` to fall back to that default.
   */
  toJsonSchema?: (
    schema: StandardSchema<any, any>,
    io: 'input' | 'output',
  ) => JsonObject | undefined;
  /**
   * Called for each operation, last. Change it in place or return a replacement. This is the
   * place to turn your own route `meta` (an access level, a scope) into `security` or text.
   */
  operation?: (operation: OpenApiOperation, route: RegisteredRoute) => OpenApiOperation | void;
  /** Called once with the finished document. */
  transform?: (document: OpenApiDocument) => OpenApiDocument | void;
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const HTTP_ERROR = {
  type: 'object',
  required: ['statusCode', 'message'],
  properties: {
    statusCode: { type: 'integer' },
    message: { type: 'string' },
    error: { type: 'string' },
  },
};

const VALIDATION_ERROR = {
  type: 'object',
  required: ['statusCode', 'message', 'issues'],
  properties: {
    statusCode: { type: 'integer', const: 400 },
    message: { type: 'string' },
    error: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'message'],
        properties: { path: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
};

interface StandardJsonSchema {
  readonly '~standard': {
    readonly jsonSchema?: Record<'input' | 'output', (options: { target: string }) => JsonObject>;
  };
}

/** Asks the schema for its JSON Schema. `undefined` when it cannot say. */
function standardJsonSchema(schema: unknown, io: 'input' | 'output'): JsonObject | undefined {
  try {
    return (schema as StandardJsonSchema)['~standard'].jsonSchema?.[io]({
      target: 'draft-2020-12',
    });
  } catch {
    // The library has a type JSON Schema cannot express (a Date, a transform, ...).
    return undefined;
  }
}

/**
 * Builds an OpenAPI 3.1 document from an app's routes. Pure: the same routes and options
 * give the same document.
 *
 * ```ts
 * const document = createOpenApiDocument(app.get(ROUTE_TABLE), { info: { title: 'Shop' } });
 * ```
 */
export function createOpenApiDocument<const S extends SecuritySchemes = {}>(
  routes: readonly RegisteredRoute[],
  options: OpenApiDocumentOptions<S> = {},
): OpenApiDocument {
  const schemas: Record<string, unknown> = {};
  const responses: Record<string, unknown> = {};
  const operationIds = new Set<string>();

  /** Moves a schema's `$defs` to `components.schemas`, so named schemas are shared. */
  const hoist = (json: JsonObject): JsonObject => {
    const { $schema: _, $defs, ...rest } = json as JsonObject & { $defs?: JsonObject };
    if (!$defs) return rest;
    // Two different schemas can carry the same name (generated names such as `__schema0`
    // do). The second one is renamed instead of silently replacing the first.
    const renamed = new Map<string, string>();
    for (const name of Object.keys($defs)) {
      const same = JSON.stringify(relink($defs[name], NO_RENAMES));
      let target = name;
      for (let n = 2; target in schemas && JSON.stringify(schemas[target]) !== same; n++) {
        target = `${name}_${n}`;
      }
      renamed.set(name, target);
    }
    for (const [name, target] of renamed) schemas[target] = relink($defs[name], renamed);
    return relink(rest, renamed) as JsonObject;
  };

  const convert = (schema: unknown, io: 'input' | 'output'): JsonObject => {
    if (!isStandardSchema(schema)) return hoist({ ...(schema as JsonObject) });
    return hoist(options.toJsonSchema?.(schema, io) ?? standardJsonSchema(schema, io) ?? {});
  };

  const errorRef = (name: 'HttpError' | 'ValidationError') => {
    schemas[name] ??= name === 'HttpError' ? HTTP_ERROR : VALIDATION_ERROR;
    return { $ref: `#/components/schemas/${name}` };
  };

  const parametersOf = (schema: unknown, where: 'query' | 'header'): JsonObject[] => {
    if (!schema) return [];
    const json = convert(schema, 'input');
    const required = new Set((json.required as string[] | undefined) ?? []);
    return Object.entries((json.properties ?? {}) as Record<string, JsonObject>).map(
      ([name, property]) => parameter(name, where, required.has(name), property),
    );
  };

  const operationOf = (route: RegisteredRoute, pathParams: string[]): OpenApiOperation => {
    const { config } = route;
    const doc = ((config.meta?.openapi as ApiDoc | undefined) ?? {}) as ApiDoc;

    const paramProperties = (
      config.params ? (convert(config.params, 'input').properties ?? {}) : {}
    ) as Record<string, JsonObject>;
    const parameters = [
      ...pathParams.map((name) =>
        parameter(name, 'path', true, paramProperties[name] ?? { type: 'string' }),
      ),
      ...parametersOf(config.query, 'query'),
      ...parametersOf(config.headers, 'header'),
    ];

    const status = config.status ?? (route.method === 'POST' ? 201 : 200);
    const out: Record<string, JsonObject> = {
      [status]: config.response
        ? { description: 'Success', content: json(convert(config.response, 'output')) }
        : { description: 'Success' },
    };
    if (config.params || config.query || config.body || config.headers) {
      responses.ValidationError ??= {
        description: 'The request did not pass validation.',
        content: json(errorRef('ValidationError')),
      };
      out[400] = { $ref: '#/components/responses/ValidationError' };
    }
    for (const [code, value] of Object.entries(doc.responses ?? {})) {
      const response = typeof value === 'string' ? { description: value } : value;
      const body =
        typeof value === 'string'
          ? errorRef('HttpError')
          : response.schema && convert(response.schema, 'output');
      out[code] = {
        description: response.description,
        ...(body
          ? { content: { [response.contentType ?? 'application/json']: { schema: body } } }
          : {}),
      };
    }

    let operationId = doc.operationId ?? route.name.replace(/[^A-Za-z0-9_]+/g, '_');
    for (let n = 2; operationIds.has(operationId); n++) operationId = `${operationId}_${n}`;
    operationIds.add(operationId);

    const operation: OpenApiOperation = {
      operationId,
      ...(doc.summary ? { summary: doc.summary } : {}),
      ...(doc.description ? { description: doc.description } : {}),
      tags: doc.tags ?? [route.feature],
      ...(doc.deprecated ? { deprecated: true } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(config.body
        ? { requestBody: { required: true, content: json(convert(config.body, 'input')) } }
        : {}),
      responses: out,
      ...(doc.security ? { security: doc.security } : {}),
    };
    return options.operation?.(operation, route) ?? operation;
  };

  const paths: OpenApiDocument['paths'] = {};
  for (const route of routes) {
    // A route for every method (`route.all`) has no single operation to describe.
    if (!METHODS.has(route.method)) continue;
    if ((route.config.meta?.openapi as ApiDoc | undefined)?.hidden) continue;
    const pathParams: string[] = [];
    const path = route.path.replace(/(^|\/)([:*])([^/]*)/g, (_, slash, _kind, name) => {
      pathParams.push(name || 'wildcard');
      return `${slash}{${name || 'wildcard'}}`;
    });
    (paths[path] ??= {})[route.method.toLowerCase()] = operationOf(route, pathParams);
  }

  const components = {
    ...(Object.keys(schemas).length ? { schemas } : {}),
    ...(Object.keys(responses).length ? { responses } : {}),
    ...(options.securitySchemes ? { securitySchemes: options.securitySchemes } : {}),
  };
  const document: OpenApiDocument = {
    openapi: '3.1.0',
    info: { title: 'API', version: '0.0.0', ...options.info },
    ...(options.servers ? { servers: options.servers } : {}),
    ...(options.tags ? { tags: options.tags } : {}),
    ...(options.security ? { security: options.security } : {}),
    paths,
    ...(Object.keys(components).length ? { components } : {}),
  };
  return options.transform?.(document) ?? document;
}

const NO_RENAMES = new Map<string, string>();

const json = (schema: unknown) => ({ 'application/json': { schema } });

function parameter(name: string, where: string, required: boolean, schema: JsonObject): JsonObject {
  const { description, ...rest } = schema;
  return {
    name,
    in: where,
    required,
    ...(typeof description === 'string' ? { description } : {}),
    schema: rest,
  };
}

/** Points `#/$defs/X` references at `#/components/schemas/<renamed X>`. */
function relink(node: unknown, renamed: Map<string, string>): unknown {
  if (Array.isArray(node)) return node.map((item) => relink(item, renamed));
  if (!node || typeof node !== 'object') return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] =
      key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')
        ? `#/components/schemas/${renamed.get(value.slice(8)) ?? value.slice(8)}`
        : relink(value, renamed);
  }
  return out;
}
