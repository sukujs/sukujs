# @suku/graphql

Class-based GraphQL resolvers for Suku, shaped like a `@Routes` class. Built on GraphQL Yoga.

```bash
bun add @suku/graphql graphql graphql-yoga
```

```ts
import { GraphqlResolver, graphql, mutation, objectType, query } from '@suku/graphql';

@GraphqlResolver({
  typeDefs: /* GraphQL */ `
    type Book { id: ID! title: String! author: Author! }
    extend type Query { books: [Book!]! }
    extend type Mutation { addBook(title: String!): Book! }
  `,
})
export class BooksResolver {
  constructor(private readonly books: BooksService) {}

  books = query({ handle: () => this.books.all() });

  addBook = mutation({
    args: z.object({ title: z.string().min(2) }),
    handle: ({ args }) => this.books.add(args.title), // args.title is a string
  });

  author = objectType<Book>('Book').field({
    services: { authors: AuthorLoader }, // request-scoped
    handle: ({ parent, authors }) => authors.load(parent.authorId),
  });
}

const BooksFeature = feature('books', { services: [BooksService, AuthorLoader, BooksResolver] });
const app = await Suku.create({ features: [BooksFeature], routes: [graphql()] });
```

- **Feature-based.** A resolver class joins the schema when it is listed in a feature's
  `services`. Remove the feature and its fields are gone.
- **Constructor injection** for singletons, a `services` option for request-scoped ones.
- **Typed, validated arguments** through any Standard Schema.
- **Schema-first.** Each class owns its slice of SDL and `extend`s the root types.
- **`ctx`** in every resolver: cookies, headers, shared state, the DI scope.
- **`graphql({ path, graphiql, maskedErrors, yoga })`** returns the route. GraphiQL is off in
  production. `createGraphqlSchema(app.provider)` builds the schema eagerly to fail at startup.

`graphql` and `graphql-yoga` are peer dependencies. Resolver classes must be singletons.
