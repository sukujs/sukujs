# Deploy example

One small API with an entry point and config for every platform in the
[deployment guide](../../apps/docs/content/docs/deployment.mdx), and a script that checks a
running deployment from the outside.

| Platform           | Entry           | Config                                            |
| ------------------ | --------------- | ------------------------------------------------- |
| Node, Bun          | `src/main.ts`   | `.env.example`                                    |
| PM2                | `src/main.ts`   | `ecosystem.config.cjs`                            |
| systemd + Nginx    | `src/main.ts`   | `deploy/suku-deploy.service`, `deploy/nginx.conf` |
| Docker             | `src/main.ts`   | `Dockerfile`, `Dockerfile.bun`                    |
| Docker Compose     | `src/main.ts`   | `docker-compose.yml`, `Caddyfile`                 |
| Cloudflare Workers | `src/worker.ts` | `wrangler.jsonc`                                  |
| Vercel             | `api/index.ts`  | `vercel.json`                                     |

The app itself is `src/app.ts` and is the same everywhere.

## What each route checks

| Route              | What it tells you about the deployment                                     |
| ------------------ | -------------------------------------------------------------------------- |
| `GET /health`      | The process answers.                                                       |
| `GET /ready`       | Where a database ping would go.                                            |
| `GET /info`        | Runtime, version, and an id per process. Several ids mean several copies.  |
| `GET /hello/:name` | Environment variables reached the app (`GREETING`).                        |
| `GET /whoami`      | The client IP, `Host` and protocol as the app sees them behind your proxy. |
| `POST /echo`       | Request bodies arrive and are validated.                                   |
| `GET /limited`     | Rate limiting: 5 a minute per client. Shows per-copy counters.             |
| `GET /slow?ms=`    | Holds a request open, to watch a graceful shutdown.                        |
| `POST /hash`       | CPU-heavy password hashing, to find a platform's CPU limit.                |

`SystemRoutes` is a class with constructor injection, so `/info` also proves that injection
survived the platform's build.

## The smoke test

Point it at any running copy, local or deployed.

```bash
bun run smoke.ts http://127.0.0.1:3000
bun run smoke.ts https://api.example.com
```

It prints what it saw (runtime, instance count, client IP, hash time) and exits non-zero if a
check fails. Two results are worth reading closely:

- **`GET /whoami` fails with "Host was not preserved"**: your proxy rewrites `Host`. Fix the
  proxy, or CSRF origin checks will reject browsers.
- **`GET /limited` allows more than 5**: several copies each keep their own count. Use a
  shared rate-limit store.

Run it at most once a minute per deployment, because it uses up the `/limited` allowance.

## Run it

Inside this repository the `@sukujs/*` packages resolve to the workspace. Copied anywhere
else, or built with Docker, the same `package.json` installs them from npm.

### Node

```bash
bun run build
PORT=3000 node dist/main.js
```

Then, in another terminal, `bun run smoke.ts`.

To see a graceful shutdown, start `curl "localhost:3000/slow?ms=5000"`, send `SIGTERM` to the
process while it waits, and check that `curl` still gets its answer before the process exits.

### Bun

```bash
PORT=3000 bun run src/main.ts
```

### PM2

```bash
bun run build
pm2 startOrReload ecosystem.config.cjs
bun run smoke.ts
```

With two workers, expect `2 instance(s)` and more than 5 requests allowed on `/limited`. That
failure is the point: it shows why cluster mode needs a shared store. Loop `curl` on `/health`
while you run `pm2 reload suku-deploy` to confirm no request is dropped.

### systemd and Nginx

Copy the built app to the server, then install `deploy/suku-deploy.service` and
`deploy/nginx.conf`. Set `HOST=127.0.0.1` and `TRUST_PROXY=1` in `.env`. From your own
machine:

```bash
bun run smoke.ts http://api.example.com
```

`/whoami` should report your public IP as `ip` and `127.0.0.1` as `peer`.

### Docker

```bash
docker build -t suku-deploy .
docker run --rm -p 3000:3000 suku-deploy
```

`docker build -f Dockerfile.bun -t suku-deploy-bun .` builds the Bun variant. `docker stop`
should return within a second or two, which shows `SIGTERM` reached the shutdown handler.

### Docker Compose

```bash
docker compose up -d --build
bun run smoke.ts http://localhost:8080
```

For several copies behind Caddy:

```bash
docker compose up -d --build --scale api=3
```

### Cloudflare Workers

```bash
bun run worker:dev
bun run smoke.ts http://127.0.0.1:8787
```

Deploy with `bun run worker:deploy`, then run the smoke test against the `workers.dev` URL.
Watch `POST /hash` there: it is the check most likely to hit a CPU limit.

### Vercel

Copy this folder out of the repository first, so Vercel installs the published packages.

```bash
vercel dev
bun run smoke.ts http://localhost:3000
```

```bash
vercel deploy
```

## Verified so far

Run in this repository: the tests, and the smoke test against Node, Bun and the local Workers
runtime (`wrangler dev`). Not yet run: PM2, systemd, Nginx, Docker, Compose, a deployed
Worker, and Vercel.
