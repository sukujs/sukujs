# Security policy

## Supported versions

Suku is released as one version across every `@sukujs/*` package. Security fixes go into the
latest release only. While Suku is below 1.0.0, upgrade to the newest version to receive them.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub:
[Report a vulnerability](https://github.com/sukujs/sukujs/security/advisories/new).
Only the maintainers can see the report.

A useful report says:

- which package and version is affected,
- what an attacker can do,
- the smallest code or request that shows it, and
- any fix or workaround you have in mind.

We will confirm the report, agree on a fix and a release with you, and credit you in the
advisory unless you ask us not to.

## Scope

In scope: the packages under `packages/` as published to npm, and the code `suku new` and
`suku generate` produce.

Out of scope: the examples and the documentation site, and problems that need an app to be
misconfigured against the documentation, such as trusting `X-Forwarded-For` with no proxy in
front.

Suku has not had an independent security audit.
