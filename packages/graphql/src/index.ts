import {
  flattenIssues,
  type InferOutput,
  type RequestContext,
  type ResolvedServices,
  type Route,
  route,
  type ServiceMap,
  type StandardSchema,
} from '@sukujs/core';
import type { Constructor, ServiceProvider } from '@sukujs/di';
import { GraphQLError, type GraphQLResolveInfo, type GraphQLSchema } from 'graphql';
import { createSchema, createYoga, type YogaServerOptions } from 'graphql-yoga';

type AnySchema = StandardSchema<any, any>;
type MaybePromise<T> = T | Promise<T>;
type Out<S, Fallback> = S extends AnySchema ? InferOutput<S> : Fallback;

// --- the class decorator -------------------------------------------------------

export interface GraphqlResolverOptions {
  /**
   * The part of the schema this class owns, in GraphQL SDL. Add fields to the root types
   * with `extend type Query { ... }`; the root types themselves are declared for you.
   */
  typeDefs: string;
}

const resolverClasses = new Map<Function, GraphqlResolverOptions>();

/**
 * Marks a class as a group of GraphQL resolvers. Its constructor is injected like any
 * service, and its fields created with `query`, `mutation`, `objectType(...).field` and `subscription`
 * become resolvers. Register the class in a feature's `services` to include it.
 *
 * ```ts
 * @GraphqlResolver({ typeDefs: `type User { id: ID! } extend type Query { users: [User!]! }` })
 * class UsersResolver {
 *   constructor(private readonly users: UsersService) {}
 *   users = query({ handle: () => this.users.all() });
 * }
 * ```
 */
export function GraphqlResolver(options: GraphqlResolverOptions): ClassDecorator {
  return (target) => {
    resolverClasses.set(target, options);
  };
}

export function isGraphqlResolver(value: unknown): value is Constructor {
  return typeof value === 'function' && resolverClasses.has(value);
}

// --- resolver fields -------------------------------------------------------------

/** What a resolver receives. `args` is typed by its schema, services arrive by name. */
export type ResolverInput<TParent, TArgs, TServices> = {
  /** The object this field belongs to. `undefined` for queries and mutations. */
  parent: TParent;
  /** The field's arguments: the schema's output, or the raw arguments without one. */
  args: Out<TArgs, Record<string, unknown>>;
  /** The Suku request context: cookies, headers, shared state, the DI scope. */
  ctx: RequestContext;
  info: GraphQLResolveInfo;
} & ResolvedServices<TServices>;

export interface ResolverOptions<TParent, TArgs, TServices, TResult> {
  /** GraphQL field name. Defaults to the class property name. */
  name?: string;
  /** A Standard Schema that validates the arguments and types `args`. */
  args?: TArgs;
  /** Services resolved from the request's scope and passed to the handler by name. */
  services?: TServices;
  handle: (input: ResolverInput<TParent, TArgs, TServices>) => TResult;
}

const FIELD: unique symbol = Symbol.for('suku:graphql-field');

export interface ResolverField {
  readonly [FIELD]: true;
  /** `Query`, `Mutation`, `Subscription`, or the name of an object type. */
  readonly type: string;
  readonly subscription: boolean;
  readonly options: ResolverOptions<any, any, any, any>;
}

function isResolverField(value: unknown): value is ResolverField {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[FIELD] === true
  );
}

function define(
  type: string,
  subscription: boolean,
  options: ResolverOptions<any, any, any, any>,
): ResolverField {
  return { [FIELD]: true, type, subscription, options };
}

/** A field on `Query`. */
export function query<
  TArgs extends AnySchema | undefined = undefined,
  TServices extends ServiceMap = {},
>(options: ResolverOptions<undefined, TArgs, TServices, MaybePromise<unknown>>): ResolverField {
  return define('Query', false, options);
}

/** A field on `Mutation`. */
export function mutation<
  TArgs extends AnySchema | undefined = undefined,
  TServices extends ServiceMap = {},
>(options: ResolverOptions<undefined, TArgs, TServices, MaybePromise<unknown>>): ResolverField {
  return define('Mutation', false, options);
}

/**
 * Resolvers for the fields of an object type, such as `Book.author`. The type parameter is
 * the shape of the parent object, named once and reused for every field.
 *
 * ```ts
 * const BookType = objectType<Book>('Book');
 *
 * author = BookType.field({ handle: ({ parent }) => this.authors.find(parent.authorId) });
 * ```
 */
export function objectType<TParent = unknown>(type: string) {
  return {
    field<TArgs extends AnySchema | undefined = undefined, TServices extends ServiceMap = {}>(
      options: ResolverOptions<TParent, TArgs, TServices, MaybePromise<unknown>>,
    ): ResolverField {
      return define(type, false, options);
    },
  };
}

/** A field on `Subscription`. The handler returns an async iterable; each value is one event. */
export function subscription<
  TArgs extends AnySchema | undefined = undefined,
  TServices extends ServiceMap = {},
>(
  options: ResolverOptions<undefined, TArgs, TServices, MaybePromise<AsyncIterable<unknown>>>,
): ResolverField {
  return define('Subscription', true, options);
}

// --- building the schema -----------------------------------------------------------

export class GraphqlSetupError extends Error {
  override readonly name = 'GraphqlSetupError';
}

interface YogaContext {
  ctx: RequestContext;
}

async function run(
  f: ResolverField,
  label: string,
  parent: unknown,
  rawArgs: Record<string, unknown>,
  context: YogaContext,
  info: GraphQLResolveInfo,
) {
  const { ctx } = context;
  let args: unknown = rawArgs;
  if (f.options.args) {
    const result = await (f.options.args as AnySchema)['~standard'].validate(rawArgs);
    if (result.issues) {
      throw new GraphQLError(`Invalid arguments for ${label}`, {
        extensions: { code: 'BAD_USER_INPUT', issues: flattenIssues(result.issues) },
      });
    }
    args = result.value;
  }
  const input: Record<string, unknown> = { parent, args, ctx, info };
  for (const [name, token] of Object.entries((f.options.services ?? {}) as ServiceMap)) {
    input[name] = ctx.provider.get(token as Constructor);
  }
  return f.options.handle(input as never);
}

/**
 * Builds the GraphQL schema from every `@GraphqlResolver` class registered in the
 * container. `graphql()` calls this on the first request; call it yourself after
 * `Suku.create` to fail at startup instead: `createGraphqlSchema(app.provider)`.
 */
export function createGraphqlSchema(provider: ServiceProvider): GraphQLSchema {
  const root = provider.root;
  const classes = [...resolverClasses.keys()].filter((cls) =>
    root.has(cls as Constructor),
  ) as Constructor[];
  if (classes.length === 0) {
    throw new GraphqlSetupError(
      'No GraphQL resolvers are registered. Decorate a class with @GraphqlResolver() and add it to the `services` of a feature.',
    );
  }

  const typeDefs: string[] = [];
  const resolvers: Record<string, Record<string, unknown>> = {};
  for (const cls of classes) {
    let instance: Record<string, unknown>;
    try {
      instance = root.get(cls) as Record<string, unknown>;
    } catch (cause) {
      throw new GraphqlSetupError(
        `Could not construct ${cls.name}: ${(cause as Error).message} A @GraphqlResolver class must be a singleton; ` +
          "take request-scoped services through a resolver's `services` option.",
        { cause },
      );
    }
    typeDefs.push(resolverClasses.get(cls)!.typeDefs);
    let count = 0;
    for (const key of Object.keys(instance)) {
      const f = instance[key];
      if (!isResolverField(f)) continue;
      count++;
      const name = f.options.name ?? key;
      const label = `${f.type}.${name}`;
      for (const [serviceName, token] of Object.entries((f.options.services ?? {}) as ServiceMap)) {
        if (!root.has(token)) {
          throw new GraphqlSetupError(
            `${cls.name}.${key} asks for service "${serviceName}", which is not registered.`,
          );
        }
      }
      const bucket = (resolvers[f.type] ??= {});
      if (name in bucket)
        throw new GraphqlSetupError(
          `${label} is defined more than once (second definition in ${cls.name}).`,
        );
      bucket[name] = f.subscription
        ? {
            subscribe: (
              parent: unknown,
              args: Record<string, unknown>,
              context: YogaContext,
              info: GraphQLResolveInfo,
            ) => run(f, label, parent, args, context, info),
            resolve: (payload: unknown) => payload,
          }
        : (
            parent: unknown,
            args: Record<string, unknown>,
            context: YogaContext,
            info: GraphQLResolveInfo,
          ) => run(f, label, parent, args, context, info);
    }
    if (count === 0) {
      throw new GraphqlSetupError(
        `${cls.name} is decorated with @GraphqlResolver() but declares no resolver fields.`,
      );
    }
  }

  // Root types are declared here so each class can simply `extend` them.
  const roots = ['Query', 'Mutation', 'Subscription']
    .filter((t) => resolvers[t])
    .map((t) => `type ${t}`);
  if (!resolvers.Query) {
    throw new GraphqlSetupError(
      'A GraphQL schema needs at least one query. Add a field with query({ ... }).',
    );
  }
  try {
    return createSchema({
      typeDefs: [...roots, ...typeDefs],
      resolvers: resolvers as never,
    }) as GraphQLSchema;
  } catch (cause) {
    throw new GraphqlSetupError(`The GraphQL schema is invalid: ${(cause as Error).message}`, {
      cause,
    });
  }
}

// --- mounting ------------------------------------------------------------------------

export interface GraphqlOptions {
  /** Where the API is served. Default `/graphql`. */
  path?: string;
  /** Serve the GraphiQL IDE on browser requests. Default: off when `NODE_ENV` is `production`. */
  graphiql?: boolean;
  /** Hide unexpected resolver errors from clients. Default `true`. */
  maskedErrors?: boolean;
  /** Further GraphQL Yoga options, such as `plugins`. */
  yoga?: Omit<
    YogaServerOptions<YogaContext, object>,
    'schema' | 'graphqlEndpoint' | 'graphiql' | 'maskedErrors'
  >;
}

/**
 * The route that serves the GraphQL API. Add it to an app's `routes`; it finds every
 * registered `@GraphqlResolver` class by itself.
 *
 * ```ts
 * Suku.create({ features: [UsersFeature], routes: [graphql()] });
 * ```
 */
export function graphql(options: GraphqlOptions = {}): Route {
  const path = options.path ?? '/graphql';
  const servers = new WeakMap<ServiceProvider, ReturnType<typeof createYoga<YogaContext>>>();
  const production =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.NODE_ENV === 'production';

  return route.all(path, {
    name: 'graphql',
    handle: ({ request, ctx }) => {
      const root = ctx.provider.root;
      let yoga = servers.get(root);
      if (!yoga) {
        yoga = createYoga<YogaContext>({
          // Suku's own middlewares handle CORS and logging; override through `yoga` if needed.
          cors: false,
          logging: false,
          ...options.yoga,
          schema: createGraphqlSchema(root),
          graphqlEndpoint: path,
          graphiql: options.graphiql ?? !production,
          maskedErrors: options.maskedErrors ?? true,
        });
        servers.set(root, yoga);
      }
      return yoga.fetch(request, { ctx });
    },
  });
}

/** Everything in one object, for `import sukuGraphql from '@sukujs/graphql'`. */
const sukuGraphql = {
  GraphqlResolver,
  query,
  mutation,
  objectType,
  subscription,
  graphql,
  createGraphqlSchema,
} as const;

export default sukuGraphql;
