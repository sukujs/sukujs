# @sukujs/platform-node

The Node.js adapter for [Suku](https://github.com/sukujs/sukujs). It connects the framework's
Fetch-based kernel to `node:http`.

```ts
import { Suku } from '@sukujs/core';
import { nodeAdapter } from '@sukujs/platform-node';

const app = await Suku.create({ features: [UsersFeature], adapter: nodeAdapter() });
await app.listen(3000);
```

- Requires Node 22 or newer.
- Streams request and response bodies, and aborts `request.signal` when the client disconnects.
- Passes the socket's peer address through as `ctx.remoteAddress`.
- `nodeAdapter({ createServer })` accepts your own server, for HTTPS.
- `getNodeRaw(request)` returns the underlying `IncomingMessage` and `ServerResponse`.

Node cannot run TypeScript decorators directly. Compile with `tsc`, or bundle, before running.
