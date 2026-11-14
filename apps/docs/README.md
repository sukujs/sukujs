# @sukujs/docs

The Suku documentation site: [Fumadocs](https://fumadocs.dev) on [TanStack Start](https://tanstack.com/start),
deployed to Cloudflare Workers.

```bash
bun run docs:dev      # from the repo root, http://localhost:3000
bun run docs:build    # production build, prerenders every page
bun run --cwd apps/docs deploy   # build + wrangler deploy
```

- Pages live in `content/docs/*.mdx`. Their order and the sidebar sections are in `content/docs/meta.json`.
- The landing page is `src/routes/index.tsx`. Site name and GitHub links are in `src/lib/shared.ts`.
- Search is built in (Orama, no external service). `/llms.txt` and `/llms-full.txt` are generated.
- Hosting uses `@cloudflare/vite-plugin` + `wrangler.jsonc` (Worker name `suku-docs` on the Graphland account for manual deploys; Git builds use Worker `sukujs`).

## Cloudflare Git builds (`Workers Builds: sukujs`)

The monorepo `bun.lock` is **lockfileVersion 2** (Bun 1.4+). The Workers Builds image defaults to
Bun **1.2.15**, which cannot read it and fails with `Unknown lockfile version` under
`--frozen-lockfile`. Do **not** delete `bun.lock` to work around this.

Open the **sukujs** Worker on the sukujs Cloudflare account → **Settings** → **Build** →
**Variables and secrets** (set on **production and preview** triggers), and add:

| Variable       | Value   |
| -------------- | ------- |
| `BUN_VERSION`  | `1.4.4` |

Dashboard (account `be6d1b4401c39fa79f3587ac0a5a5620`):

https://dash.cloudflare.com/be6d1b4401c39fa79f3587ac0a5a5620/workers/services/view/sukujs

Suggested build settings:

| Setting         | Value                                              |
| --------------- | -------------------------------------------------- |
| Root directory  | `apps/docs` (or `/` with a cwd-aware command)      |
| Build command   | `bun run build`                                    |
| Deploy command  | `bunx wrangler deploy`                             |

After saving, the next build log must show `bun@1.4.4`, not `bun@1.2.15`.
