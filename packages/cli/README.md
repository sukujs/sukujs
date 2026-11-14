# @sukujs/cli

The command line for [Suku](https://github.com/sukujs/sukujs): create a project, generate
features, routes and services, and run, build and start your app.

```bash
bunx @sukujs/cli new my-api
```

`suku new` asks for the production runtime, the package manager (Bun by default), deployment
targets (Docker, PM2, systemd, Cloudflare Workers, Vercel), whether to initialise git, and
whether to install. Every question has a flag, and `--yes` takes the defaults.

```bash
suku new my-api --runtime bun --deploy docker,cloudflare --yes
```

## Commands

| Command                            | What it does                                     |
| ---------------------------------- | ------------------------------------------------ |
| `suku new [name]`                  | Create a project                                 |
| `suku generate <schematic> <name>` | Generate code and register it (alias `g`)        |
| `suku dev`                         | Run the app with Bun and restart on change       |
| `suku build`                       | Bundle the app and its dependencies into `dist/` |
| `suku start`                       | Run the built app with Node or Bun               |
| `suku info`                        | Print versions, for bug reports                  |

## Schematics

| Schematic    | Alias | Creates                                                |
| ------------ | ----- | ------------------------------------------------------ |
| `resource`   | `res` | A CRUD feature: routes, service, schemas and a test    |
| `feature`    | `f`   | A feature                                              |
| `routes`     | `r`   | A `@Routes` class, or `route.group` with `--classless` |
| `service`    | `s`   | A `@Service` class, or `service()` with `--classless`  |
| `middleware` | `mw`  | A middleware                                           |

```bash
suku g resource products
suku g routes billing --classless
suku g service admin/reports --dry-run
```

Generated features are added to your root feature, and routes and services to the feature in
their folder. Nothing is overwritten without `--force`.

`suku dev` and `suku build` need [Bun](https://bun.sh). The built app runs on Node 22+ or Bun.

Full reference: the CLI page of the Suku documentation.
