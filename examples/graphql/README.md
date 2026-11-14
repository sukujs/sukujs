# graphql

The working app behind the GraphQL guide in the docs: GraphQL Yoga mounted on one Suku route,
sharing services with a REST route.

```bash
bun run dev      # then open http://localhost:3000/graphql
bun test         # every pattern in the guide, run against the real library
```

Suku has no first-party GraphQL support by design. This example and its tests are how the
guide is kept honest.
