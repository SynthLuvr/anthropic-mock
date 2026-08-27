# ADR 0005: Add an OpenAI provider mock

| Field  | Value                                      |
|--------|--------------------------------------------|
| Status | Accepted                                   |
| Date   | 2026-08-27                                 |
| Tags   | architecture, http, streaming, api, openai |

## Context

The project (now `llm-mock`) mocks the Anthropic API so client code —
originally goose — can be exercised without network access or API costs.
goose also speaks the OpenAI API (`POST /v1/chat/completions`,
`GET /v1/models`, via `OPENAI_HOST`), and so do most other LLM clients.
Repurposing the project into a general LLM mock means supporting OpenAI
alongside Anthropic rather than forking the codebase per provider.

The two APIs share a base URL layout (`/v1/...`) and an SSE-based
streaming style, but differ in the details:

- **Frame format.** Anthropic SSE frames are named events
  (`event: message_start` + `data: {...}`); OpenAI frames carry `data:`
  lines only, each a `chat.completion.chunk` object with the semantic
  information (role delta, content delta, finish reason) inside the
  payload.
- **Endpoints.** `POST /v1/messages` (Anthropic) vs
  `POST /v1/chat/completions` (OpenAI).
- **Streaming default.** The Anthropic mock always streams (ADR 0001
  kept goose’s `"stream": true` path simple). OpenAI clients commonly
  default to *non-streaming* and expect one `chat.completion` JSON body.
- **Error shapes.** Anthropic’s mid-stream channel is an `event: error`
  frame (ADR 0004); OpenAI’s is a `data: {"error": {...}}` frame, and
  its general error object is
  `{"error": {"message", "type", "param", "code"}}`.
- **`GET /v1/models` response shape.** Anthropic:
  `{"data":[{"id","type":"model","display_name"}]}`; OpenAI:
  `{"object":"list","data":[{"id","object":"model","created","owned_by"}]}`.

## Decision

1.  **One provider per Fastify app.** `createAnthropicMock()` and
    `createOpenAIMock()` each register that provider’s routes on their
    own app. A combined app would collide on `GET /v1/models`, and
    merging the two response shapes (a union object) would be unfaithful
    to both APIs and could confuse strict clients. The standalone
    launcher picks the provider via CLI argument or `LLM_MOCK_PROVIDER`
    and gives them distinct default ports (8787 anthropic, 8788 openai)
    so both can run side by side.

2.  **Shared streaming core, provider-specific frames.** The SSE
    mechanics that must behave identically for both providers —
    fixed-width text splitting, per-frame delay, socket `write`s after
    `reply.hijack()`, backpressure handling (`once(raw, "drain")`),
    `setNoDelay`, the `data: [DONE]` terminator, and the
    stream-for-duration error body — live in `src/sse.ts`. Providers
    build their own frame sequences on top. The `SseEvent` type carries
    an optional event name: present for Anthropic, absent for OpenAI.

3.  **One shared options type.** `MockOptions` configures both mocks.
    Every option has the same meaning per provider; only defaults differ
    (e.g. default model, default SSE error type).
    `inputTokens`/`outputTokens` map to `usage.input_tokens` /
    `usage.prompt_tokens` respectively.

4.  **OpenAI honours the `stream` flag.** `"stream": true` produces the
    chunked SSE stream; otherwise the route returns one
    `chat.completion` JSON body — the OpenAI default and what
    non-streaming SDK users expect. The Anthropic route keeps its
    always-stream behaviour (ADR 0001). Error modes apply to
    non-streaming requests too, mapped to the closest analogue: after
    the configured delay the request fails with the OpenAI error object
    as an HTTP `500` body.

5.  **Deterministic envelopes.** The OpenAI mock stamps fixed values —
    `chatcmpl-mock-0001`, created `1735689600`, fingerprint
    `fp_llm_mock_0000` — so responses are byte-for-byte reproducible in
    tests, mirroring `msg_mock_0001` on the Anthropic side.

## Consequences

- goose integration tests run against both providers (the OpenAI one via
  `OPENAI_HOST`), proving the wire formats against a real client.
- Adding a future provider (e.g. another OpenAI-compatible API) means
  writing frame builders plus two route registrations; the streaming
  core and options are reused as-is.
- The package is renamed `llm-mock` and the launcher becomes
  `bin/llm-mock`; the Anthropic entry points
  (`createAnthropicMock`/`startAnthropicMock`) keep their names.
