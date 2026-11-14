# @sukujs/docs

The Suku documentation site: [Fumadocs](https://fumadocs.dev) on [TanStack Start](https://tanstack.com/start).

```bash
bun run docs:dev      # from the repo root, http://localhost:3000
bun run docs:build    # production build, prerenders every page
```

- Pages live in `content/docs/*.mdx`. Their order and the sidebar sections are in `content/docs/meta.json`.
- The landing page is `src/routes/index.tsx`. Site name and GitHub links are in `src/lib/shared.ts`.
- Search is built in (Orama, no external service). `/llms.txt` and `/llms-full.txt` are generated.
- The build targets a Node server. Set `NITRO_PRESET` (`vercel`, `cloudflare-pages`, `bun`, ...) to target a host.

## Cloudflare

The monorepo `bun.lock` is **lockfileVersion 2** (Bun 1.4+). Cloudflare’s default Workers
build image still ships Bun **1.2.x**, which cannot read it and fails with
`Unknown lockfile version` under `--frozen-lockfile`.

In the Pages / Workers project, set a **build** environment variable (production **and**
preview triggers, if you have both):

| Variable | Value |
| --- | --- |
| `BUN_VERSION` | `1.4.4` |
| `NITRO_PRESET` | `cloudflare-pages` |

Suggested build settings for a monorepo root deploy:

| Setting | Value |
| --- | --- |
| Root directory | `/` (repo root) |
| Build command | `bun run docs:build` |
| Deploy / output | Nitro’s Cloudflare Pages output (see TanStack Start hosting docs) |

After changing `BUN_VERSION`, the build log should show `bun@1.4.4` (not `1.2.15`).
