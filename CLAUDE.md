# Suku: project rules

## Versioning: one version for every package

All publishable packages share a single version number. They are released together, always.

- **Scope.** Every package under `packages/*`: `@sukujs/core`, `@sukujs/di`, `@sukujs/crypto`,
  `@sukujs/security`, `@sukujs/graphql`, `@sukujs/openapi`, `@sukujs/cli`, `@sukujs/platform-node`, `@sukujs/platform-bun`,
  and any package added later.
  Private workspaces (`apps/*`, `examples/*`, `benchmarks`, the repo root) carry no version.
- **Always identical.** The `version` field in every `packages/*/package.json` must be the same
  string. Never bump one package on its own, even if it is the only one that changed.
- **Bump together, in one commit.** A release changes every package's version in a single
  commit titled `chore(release): vX.Y.Z`, and nothing else goes in that commit.
- **One tag per release.** Tag that commit `vX.Y.Z`. There are no per-package tags.
- **The highest change wins.** The size of the bump is decided by the most significant change
  in any package since the last release:
  - a breaking change anywhere → major (while the version is below `1.0.0`: minor)
  - a new feature anywhere → minor (below `1.0.0`: patch is acceptable for small additions)
  - fixes only → patch
- **Unchanged packages are still published** at the new version, so users can install every
  `@sukujs/*` package at one version and know they work together.
- **Internal dependencies stay as `workspace:*`.** Never write a version range for another
  `@sukujs/*` package by hand. The publish step replaces `workspace:*` with the release version.
- **Standalone examples are the exception.** An example meant to be copied out of the repo,
  such as `examples/deploy`, lists `@sukujs/*` as `^<current version>` so it installs from npm
  on its own. Bun links the workspace only while that range matches, so `version:set` and
  `version:bump` rewrite these ranges, and `version:check` fails on a stale one. Never use
  `latest`: Bun then installs the published package instead of the workspace.
- **A new package starts at the current shared version**, not at `0.0.0` or `0.1.0`.
- **Docs and READMEs refer to one version.** Write "Suku 0.3.0", never a version per package.

### Enforced by a script

```bash
bun run version:check          # fails if versions differ, an internal dependency is not workspace:*,
                               # or an example's @sukujs/* range no longer matches the version
bun run version:set 0.3.0      # set every package to an exact version
bun run version:bump patch     # or minor, or major
```

`version:check` runs first in `bun run check` and in CI, so a mismatch cannot be merged.
Always change versions with `version:set` or `version:bump`, never by editing the files by
hand. Those commands only edit the `package.json` files; committing and tagging are separate
steps.

Releasing:

1. `bun run version:bump <patch|minor|major>`
2. `bun run check`
3. `git commit -am "chore(release): vX.Y.Z"`
4. `git tag vX.Y.Z`
5. `bun run release:dry-run` and read what would be published
6. `bun run release:publish`
7. `git push origin main --tags`

### Publishing

`scripts/publish.ts` publishes every package at the shared version, dependencies first, with
public access. It refuses unless the versions are unified and not `0.0.0`, the git tree is
clean, `HEAD` is tagged with the version, you are logged in to npm, and none of the versions
already exist. `bun publish` rewrites `workspace:*` to the exact release version.

- **Never publish by hand** with `npm publish` in one package. Always use the script, so every
  package goes out together.
- **Publishing is permanent.** A version can never be reused. Always run the dry run first.
- **Never publish from an agent without the user's explicit go-ahead for that version.** Logging
  in to npm is the user's step.
- If a publish fails partway, the packages before it in the order are already out. Fix the
  cause and rerun; the script skips nothing, so bump to a new patch version if any are live.
- The `@sukujs` scope must be an npm organisation or user the publisher belongs to.
- **Two-factor authentication.** With 2FA on for writes, npm asks for a one-time code for each
  package. Run `bun run release:publish` in your own terminal so the prompts appear; it cannot
  be run unattended.

## Imports: no file extensions

Relative imports are written without an extension: `from './kernel'`, never `from './kernel.js'`.

- `tsconfig.base.json` uses `"module": "Preserve"` and `"moduleResolution": "Bundler"`, so the
  extension is not needed. Do not switch a package back to `NodeNext`.
- This holds for packages, examples, tests, CLI templates and code in the docs.
- One exception: a `*.node-test.ts` file runs under Node without a bundler, so it imports the
  source it tests with its real extension, `../src/index.ts`.
- The CLI still reads the style of an existing project and follows it (`importExtension`).

## Scope: GraphQL lives in `@sukujs/graphql`, never in core

Suku ships first-party GraphQL support as its own package. (This replaces an earlier decision,
made the same day, to offer guides only.)

- **One package.** `@sukujs/graphql` provides `@GraphqlResolver`, `query`, `mutation`,
  `objectType(...).field`, `subscription` and the `graphql()` route. It follows the unified
  version rule like every other package.
- **Core stays neutral.** Nothing GraphQL-specific goes into `@sukujs/core`, `@sukujs/di` or any
  other package. A change there made for GraphQL's benefit must be generally useful.
- **GraphQL libraries are peer dependencies.** `graphql` and `graphql-yoga` are peers of
  `@sukujs/graphql`, never bundled and never a dependency of another package. Apps that do not
  use GraphQL install nothing.
- **Same shape as REST.** A resolver class mirrors a `@Routes` class: constructor injection,
  fields as resolvers, a `services` option for request-scoped dependencies, a Standard Schema
  for arguments. Keep the two in step when either changes.
- **Schema-first.** The schema is written in SDL on the decorator. Do not add a code-first
  type system or field decorators; users who want that can pair Suku with a dedicated library.
- **Tested against the real library.** Every documented pattern runs in a test.
- **Other API styles stay as guides.** tRPC, oRPC and similar get documentation, not packages,
  unless that is decided separately.

## Scope: OpenAPI lives in `@sukujs/openapi`, never in core

Suku ships OpenAPI generation and API reference UIs as its own package.

- **One package.** `@sukujs/openapi` provides `openapi()` (the document and UI routes),
  `apiDoc()`, `createOpenApiDocument()` and the UIs `swaggerUi()`, `scalar()` and `redoc()`. It
  follows the unified version rule like every other package.
- **Core stays neutral.** Nothing OpenAPI-specific goes into `@sukujs/core`. The package reads
  the generic `ROUTE_TABLE` and a route's `meta`; a change in core made for its benefit must be
  generally useful.
- **Zero dependencies besides `@sukujs/core`.** No schema library, no `swagger-ui-dist`, no
  `@scalar/*`. UIs are HTML pages that load from a CDN at a pinned version. Schemas are
  converted through Standard JSON Schema, or the user's `toJsonSchema`.
- **The schema is the source.** The document comes from a route's `params`, `query`, `headers`,
  `body`, `response` and `status`. Do not add property decorators or class-based DTOs.
  `apiDoc()` only adds what a schema cannot say, and never changes behaviour.
- **Document what core really does.** Defaults such as the success status and the validation
  error body must match the kernel. When one changes, change both, with a test.
- **The UI page keeps a strict Content-Security-Policy** (nonce for inline scripts), so it
  works beside `securityHeaders()`. A new built-in UI is checked in a browser under that policy.
- **Tested against real routes.** Every documented pattern runs in a test.
- **The CLI offers it.** `suku new --openapi <swagger|scalar|redoc>` and `suku generate openapi`
  wire the package into a project. A new built-in UI gets a choice there too.

## Scope: databases are guides, not packages

Suku ships no database layer and no ORM integration packages.

- **No `@sukujs/drizzle`, `@sukujs/prisma` or similar.** A database library is an ordinary service,
  and the docs show how to wire each one. Do not add database dependencies to any package
  under `packages/`.
- **One pattern for all of them**, documented in the Database section: a connection service
  with `dispose` registered through `factory`, a repository behind an abstract class, domain
  errors thrown from the repository, and one `onError` handler mapping them to HTTP.
- **Guides are tested.** `examples/database` implements the same contract on every library the
  docs cover, and one suite runs identical checks against each. Add a library to the docs only
  with an implementation and a passing run there. Sketches that cannot be run in process
  (they need a server) must say so on the page.
- **In-process databases only in tests:** SQLite, or PGlite for PostgreSQL. Tests must not
  need a database server.
- **Compatibility fixes belong in the packages.** If a library exposes a problem in Suku, such
  as `reflect-metadata` load order, fix Suku generally and add a test.

## Scope: the CLI generates code, it is not a runtime dependency

`@sukujs/cli` provides the `suku` command: `new`, `generate`, `dev`, `build`, `start`, `info`.

- **Zero dependencies.** Node built-ins only. Prompts, argument parsing and templates are in
  the package. It never imports another `@sukujs/*` package.
- **Apps never import it.** It is a dev dependency of generated projects. Nothing in
  `packages/*` depends on it.
- **Generated code follows the docs.** A template that shows a pattern must match the page that
  documents it. When a convention changes, change both.
- **Tested end to end.** The suite creates a project, generates into it, runs its tests,
  typechecks it, builds it and serves requests from the bundle.
- **Bun is the toolchain.** `dev` and `build` call Bun, because it emits decorator metadata.
  The built app runs on Node or Bun.
- **`suku new` asks, flags answer.** Every question has a flag, and `--yes` or a missing
  terminal takes the defaults, so the command works in scripts.
- **Never overwrite silently.** A generator refuses to replace a file without `--force`.
