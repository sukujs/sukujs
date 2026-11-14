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
