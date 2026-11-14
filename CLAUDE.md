# Suku: project rules

## Versioning: one version for every package

All publishable packages share a single version number. They are released together, always.

- **Scope.** Every package under `packages/*`: `@suku/core`, `@suku/di`, `@suku/crypto`,
  `@suku/security`, `@suku/platform-node`, `@suku/platform-bun`, and any package added later.
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
  `@suku/*` package at one version and know they work together.
- **Internal dependencies stay as `workspace:*`.** Never write a version range for another
  `@suku/*` package by hand. The publish step replaces `workspace:*` with the release version.
- **A new package starts at the current shared version**, not at `0.0.0` or `0.1.0`.
- **Docs and READMEs refer to one version.** Write "Suku 0.3.0", never a version per package.

### Enforced by a script

```bash
bun run version:check          # fails if versions differ or an internal dependency is not workspace:*
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
- The `@suku` scope must be an npm organisation or user the publisher belongs to.

## Scope: GraphQL lives in `@suku/graphql`, never in core

Suku ships first-party GraphQL support as its own package. (This replaces an earlier decision,
made the same day, to offer guides only.)

- **One package.** `@suku/graphql` provides `@GraphqlResolver`, `query`, `mutation`,
  `objectType(...).field`, `subscription` and the `graphql()` route. It follows the unified
  version rule like every other package.
- **Core stays neutral.** Nothing GraphQL-specific goes into `@suku/core`, `@suku/di` or any
  other package. A change there made for GraphQL's benefit must be generally useful.
- **GraphQL libraries are peer dependencies.** `graphql` and `graphql-yoga` are peers of
  `@suku/graphql`, never bundled and never a dependency of another package. Apps that do not
  use GraphQL install nothing.
- **Same shape as REST.** A resolver class mirrors a `@Routes` class: constructor injection,
  fields as resolvers, a `services` option for request-scoped dependencies, a Standard Schema
  for arguments. Keep the two in step when either changes.
- **Schema-first.** The schema is written in SDL on the decorator. Do not add a code-first
  type system or field decorators; users who want that can pair Suku with a dedicated library.
- **Tested against the real library.** Every documented pattern runs in a test.
- **Other API styles stay as guides.** tRPC, oRPC and similar get documentation, not packages,
  unless that is decided separately.

## Scope: databases are guides, not packages

Suku ships no database layer and no ORM integration packages.

- **No `@suku/drizzle`, `@suku/prisma` or similar.** A database library is an ordinary service,
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
