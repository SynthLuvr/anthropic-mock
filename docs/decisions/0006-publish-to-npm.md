# ADR 0006: Publish to npm via OIDC trusted publishing

| Field  | Value                                  |
|--------|----------------------------------------|
| Status | Accepted                               |
| Date   | 2026-08-28                             |
| Tags   | release, ci, npm, publishing, security |

## Context

The package is consumed today via local link installs
(`pnpm add -D llm-mock@link:../anthropic-mock`), which only works from a
sibling checkout. Publishing to npm makes it installable anywhere and
gives consumers semver updates.

Two name constraints shape the decision. The unscoped npm name
`llm-mock` is already taken by an unrelated package (as is
`anthropic-mock`), while the maintainer’s npm account `synthluvr` (which
publishes `type-a-bin` and `ts-canon`) owns the `@synthluvr` scope, so a
scoped name is guaranteed available and keeps the `llm-mock` product
name.

The in-org release pattern — proven by `type-a-bin` and, since v0.1.1,
by `ts-canon` — is a manually dispatched Release workflow that publishes
via npm **OIDC trusted publishing**: no long-lived `NPM_TOKEN` secret
exists anywhere; instead npm verifies a short-lived, per-run OIDC token
against a trusted-publisher configuration on npmjs.com. The repo’s
`main` branch is protected by a ruleset (PRs required before merging, no
bypass actors), so version bumps must land via PR, not direct push.

Provenance attestations (`--provenance`) require a public repository and
a `repository.url` in `package.json` that matches the GitHub repository
— here `SynthLuvr/anthropic-mock`, the repo’s historical name, which
differs from the package name.

## Decision

1.  **Publish as `@synthluvr/llm-mock`** with
    `publishConfig.access: "public"` (scoped packages default to
    restricted) and keep the unscoped `llm-mock` bin name.

2.  **Ship TypeScript source, not build output** (the ts-canon model):
    `files` includes `bin` and `src` but excludes `src/tests`, so the
    published tarball mirrors the link-install consumer experience
    (`exports` points at `src/create-mock.ts`). `tsx` moves from
    devDependencies to dependencies because the published `bin/llm-mock`
    launcher runs `node --import tsx`.

3.  **Manually dispatched Release workflow**
    (`.github/workflows/release.yml`) on `main`, taking either an exact
    `version` (semver-validated) or a `bump` choice. It runs the full
    gate (pandoc install, `pnpm build && pnpm lint && pnpm test`), then
    `npm publish --provenance` authenticated by the OIDC exchange
    (`id-token: write`; no registry token is configured). Publishing is
    idempotent — it skips when `@synthluvr/llm-mock@<version>` already
    exists — so a run that failed after publishing can be re-run to
    finish bookkeeping.

4.  **Bookkeeping after npm accepts the package:** the version bump
    lands via a short-lived `release/v<version>` PR that the workflow
    opens and squash-merges itself (the ruleset’s 0-approval requirement
    permits this), then the verified merge commit is tagged `v<version>`
    and a GitHub release is created with the npm link. A `dist` branch
    snapshot of the tagged commit is force-pushed as the git-tarball
    fallback for git-ref consumption (npm stays the primary channel).

## Consequences

- One-time maintainer setup, none of it in CI secrets: publish
  `@synthluvr/llm-mock@0.1.0` once manually (a trusted publisher cannot
  be configured on a package that does not exist yet), add the trusted
  publisher on npmjs.com (owner `SynthLuvr`, repository
  `anthropic-mock`, workflow filename `release.yml`, allowed action
  `npm publish`), and enable “Allow GitHub Actions to create and approve
  pull requests” in the repo’s Actions settings for the version-bump PR
  step.
- Every release produces a provenance attestation users can verify,
  unless `repository.url` and the GitHub repo drift apart (an E422
  publish failure makes that visible).
- Consumers on TypeScript-unaware tooling cannot import the package
  until a compiled build exists; that is unchanged from the link-install
  status quo and can be a future ADR.
- The first release published by the workflow will be `0.1.1` or later;
  `0.1.0` comes from the one-time manual publish above.
