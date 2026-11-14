# graphql

The manual approach from the GraphQL guide in the docs: GraphQL Yoga mounted on one Suku route,
sharing services with a REST route.

```bash
bun run dev      # then open http://localhost:3000/graphql
bun test         # every pattern in the guide, run against the real library
```

This example mounts GraphQL Yoga by hand, without `@suku/graphql`. It shows what that package
does for you, and how to mount any other Fetch-based server the same way.
