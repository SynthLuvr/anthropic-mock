# ADR 0008: Rule engine and fault outcomes, adapted from npm llm-mock

| Field  | Value                                             |
|--------|---------------------------------------------------|
| Status | Accepted                                          |
| Date   | 2026-08-28                                        |
| Tags   | architecture, rules, fault-injection, config, api |

## Context

Until now every response was canned: one fixed text per server, chosen
by options. That covers happy-path tests, but two things npm
[`llm-mock`](https://www.npmjs.com/package/llm-mock) does well are
missing here:

1.  **Config-driven behavior.** llm-mock routes each request to a *case*
    whose `pattern` (a `{{var}}` template) matches the prompt, captures
    variables, applies declarative guards to them, and replies through
    an interpolated template; *scenarios* step through ordered replies;
    and `defaults.fallback` answers unmatched prompts.

2.  **Breadth of fault injection.** llm-mock can answer with a wide
    range of HTTP errors (`HTTP_400`…`HTTP_503`, plus `HTTP_429` with
    `Retry-After`), malformed JSON, and timeouts — each conditional on
    provider/model/headers/stream/env — with probabilistic `ratio`.

This package already had two fault modes (`streamErrorAfterMs`,
`streamSseErrorAfterMs`, ADRs 0003/0004) but they are global options,
not per-request routing, and cannot produce pre-stream HTTP errors at
all.

The task that motivated this ADR numbered it 0007; by the time it was
implemented, ADR 0007 (the rename) had landed, so this decision is 0008.

## Decision

Introduce a rule engine under `src/rules/` — adapted to Fastify,
TypeScript, and arktype, with no new dependencies — and hang fault
outcomes off the same rules.

### What is introduced

| From npm llm-mock | Adaptation here |
|----|----|
| Cases: `pattern` + `{{var}}` capture → `reply`/`replyTemplate` | `MockRule.when.pattern` compiled to a case-insensitive, whitespace-tolerant, fully anchored regex; a single `reply` field, always `{{var}}`-interpolated |
| Guards: `equals/includes/oneOf/matches` on captured vars | `MockRule.guard` — the same four ops, evaluated case-insensitively (except `matches`, a case-sensitive regex, as in llm-mock) |
| Scenario sequences | `MockRule.sequence` — ordered replies across successive matching requests; the last entry repeats (linear only, no state machine) |
| Match conditions | `when.provider`, `when.model` (string or list), `when.headers`, `when.stream` |
| `defaults.fallback` | `MockOptions.fallbackResponse` — outranks the canned response for requests no rule matches; the canned text stays the ultimate default |
| Probabilistic faults (`ratio`) | `MockRule.ratio` in \[0, 1\]; a failed roll falls through to later rules without consuming a sequence step |
| Config file (YAML/JSON/JS DSL) | **JSON only**, via `LLM_MOCKINGBIRD_RULES=path.json` for the standalone server; library users pass rules inline as `MockOptions.rules` |

### Fault outcomes on rules

| From npm llm-mock | Adaptation here |
|----|----|
| `HTTP_400…503` + `HTTP_429.retryAfterSec` | `MockRule.status` (any code) + `retryAfterSec`; provider-shaped error bodies (Anthropic `{"type":"error",…}`, OpenAI `{"error":{…}}`) with a status→type mapping, overridable via `errorType`/`errorMessage` |
| `MALFORMED_JSON` | `MockRule.malformedJson: true` → `200` + the truncated body `{"not":"closed"` |
| `TIMEOUT` (never responds) | `MockRule.timeoutAfterMs` — a **bounded** hang, then socket destroy, so tests terminate |
| Latency profiles (mean/p95/jitter) | `MockRule.delayMs` — a fixed pre-response delay; random profiles are rejected as nondeterministic |
| `when` conditions on faults | Covered by `when.*` and `ratio` on the same rule |

Files: `src/rules/{types,patterns,engine,faults,schemas,loadRules}.ts`;
the engine is wired into `create-mock.ts` and both completion routes;
`src/server.ts` reads `LLM_MOCKINGBIRD_RULES`. (The env var follows ADR
0007’s `LLM_MOCKINGBIRD_*` naming rather than the `LLM_MOCK_RULES` alias
that predates the rename.)

### Deliberately not introduced

- **State-machine scenario graphs.** llm-mock’s branching
  `steps: { stateId: { branches: [...] } }` scenarios need session state
  and graph semantics; the linear `sequence` covers the common
  multi-turn case deterministically.
- **Fuzzy / n-gram semantic matching.** `scoreFuzzy` (Jaro-Winkler +
  token overlap) and `scoreNgramSemantic` rank near-misses
  probabilistically; a mock should match the same request the same way
  every time.
- **`httpMocks` / `httpProfiles`.** Out of scope: this package mocks the
  LLM provider endpoints, not arbitrary HTTP.
- **VCR recording/replay.** A cassette layer duplicates what
  `onRequest` + rules already cover for testing.
- **Express middleware mounting.** These mocks are Fastify apps
  (`inject()` for in-process tests), not connect-style middleware.
- **YAML/JS config files.** JSON only, to stay dependency-free (no YAML
  parser) and eval-free (no `import()` of config code).
- **Named fault-kind enum** (`HTTP_429`, `TIMEOUT`, …) — declarative
  fields (`status`, `timeoutAfterMs`, …) instead, one concept per field.
- **`STREAM_DROP_AFTER`** — already exists as `streamErrorAfterMs` (ADR
  0003). **`STREAM_DUPLICATE_CHUNK`** is dropped: no provider client is
  known to mis-handle it, and it can be added later if a test needs it.

## Consequences

- Rules only apply to the completion endpoints (`POST /v1/messages`,
  `POST /v1/chat/completions`); `GET /v1/models` stays static.
- A matched rule’s reply replaces the canned text for that request; when
  no rule matches, `fallbackResponse` (if set) replaces it, and
  otherwise the canned chain applies unchanged. Existing tests and
  options are unaffected when no rules are configured.
- Fault-only rules (e.g. `status` with no `reply`) answer the request
  with the fault; a `reply`-less, fault-less delay rule delays the
  fallback reply.
- Sequence state lives per mock instance, so parallel tests against one
  app share a sequence (same as llm-mock’s single session).
- `ratio` uses `Math.random()`, so tests must pin it to 0 or 1 for
  deterministic assertions.
- Invalid JSON rule files fail standalone-server startup with a message
  naming the file and the offending rule; inline library rules are
  TypeScript-checked instead of runtime-validated.
