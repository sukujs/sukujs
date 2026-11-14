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
