# ADR 0007: Rename the project to llm-mockingbird

| Field  | Value                        |
|--------|------------------------------|
| Status | Accepted                     |
| Date   | 2026-08-28                   |
| Tags   | rename, naming, npm, release |

## Context

The repository began as `anthropic-mock`, was repurposed as `llm-mock`
when the OpenAI provider was added (ADR 0005), and — because the
unscoped npm name `llm-mock` was already taken by an unrelated package —
was slated for publication as `@synthluvr/llm-mock` (ADR 0006). Nothing
has been published to npm under any of these names yet, and the GitHub
repository is still called `anthropic-mock`, so every surface carries a
different historical name.

## Decision

Rename the project to **llm-mockingbird** everywhere at once:

1.  **GitHub repository**: `SynthLuvr/llm-mockingbird`. Update
    `repository`, `bugs`, and `homepage` in `package.json` so npm
    provenance attestations match (they require `repository.url` to
    equal the real repository).

2.  **npm package**: publish unscoped as `llm-mockingbird`. The name is
    free on npm (checked 2026-08-28), so the ADR 0006 scoping workaround
    is no longer needed.

3.  **Launcher**: `bin/llm-mockingbird`, exposed as the
    `llm-mockingbird` bin; diagnostic messages use the
    `llm-mockingbird:` prefix.

4.  **Environment variables**: `LLM_MOCKINGBIRD_PROVIDER`,
    `LLM_MOCKINGBIRD_CANNED_RESPONSE`, and `LLM_MOCKINGBIRD_LOG` replace
    the `LLM_MOCK_*` names.

5.  **Wire fixtures**: the OpenAI `system_fingerprint` constant becomes
    `fp_llm_mockingbird_0000` and the canned greeting now says “canned
    response from llm-mockingbird”. Both are canned mock responses, so
    changing the bytes is safe; tests and README examples move with
    them.

ADR 0005 and ADR 0006 keep their historical names — they record the
decisions made at the time, including the names they chose.

## Consequences

- The GitHub repository rename (a manual, post-merge step) redirects the
  old URL, so existing clones and links keep working.
- The npm trusted-publisher configuration on npmjs.com must be created
  for `llm-mockingbird` (owner `SynthLuvr`, repository
  `llm-mockingbird`, workflow `release.yml`) before the first release,
  as ADR 0006 describes.
- Consumers import from `llm-mockingbird` instead of `llm-mock` or
  `@synthluvr/llm-mock`. Nothing was published under the old names, so
  no `npm deprecate` cleanup is required.
