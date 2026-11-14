# @suku/platform-bun

The Bun adapter for [Suku](https://github.com/sukujs/sukujs). It connects the framework's
Fetch-based kernel to `Bun.serve`.

```ts
import { Suku } from '@suku/core';
import { bunAdapter } from '@suku/platform-bun';

const app = await Suku.create({ features: [UsersFeature], adapter: bunAdapter() });
await app.listen(3000);
```

Bun's server already speaks Fetch `Request` and `Response`, so the adapter adds no measurable
overhead. It passes the peer address through as `ctx.remoteAddress`.
