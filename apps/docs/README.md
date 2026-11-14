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
- Hosting uses `@cloudflare/vite-plugin` + `wrangler.jsonc` (Worker name `suku-docs`).

## Cloudflare CI (Git builds)

The monorepo `bun.lock` is **lockfileVersion 2** (Bun 1.4+). Set these **build** variables on
production and preview triggers:

| Variable | Value |
| --- | --- |
| `BUN_VERSION` | `1.4.4` |

| Setting | Value |
| --- | --- |
| Root directory | `apps/docs` (or repo root with a cwd-aware command) |
| Build command | `bun run build` |
| Deploy command | `bunx wrangler deploy` |
