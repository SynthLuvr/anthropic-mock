# ADR 0002: Stream responses incrementally over the raw socket

| Field  | Value                              |
|--------|------------------------------------|
| Status | Accepted                           |
| Date   | 2026-08-02                         |
| Tags   | architecture, http, streaming, api |

## Context

[ADR 0001](./0001-use-fastify-for-http-mock.md) chose Fastify because it
alone offered **“true incremental streaming that is also repeatable”**,
and called out `reply.hijack()` + `reply.raw` as the mechanism. The
initial implementation (PR \#1) honoured the event *sequence* but not
the *timing*: it built the whole SSE body with `serializeEvents()` and
handed it to `reply.send()` in one call. Fastify then wrote the entire
payload in a single burst.

That is good enough for a client that reads the body to completion, but
it diverges from the real Anthropic API, which emits token fragments as
they are produced, and it cannot exercise the client behaviours a
fidelity mock exists to surface — progressive rendering, backpressure,
slow-token delivery, or a mid-stream error after `message_start`.

## Decision

Make `POST /v1/messages` a genuine incremental stream:

1.  **Hijack the reply.** The handler calls `reply.hijack()` and writes
    each SSE frame straight to `reply.raw` with `writeHead()` +
    `write()`, ending with the `data: [DONE]` frame. Fastify stops
    serialising once the reply is hijacked, so nothing buffers the body.
2.  **Chunk the text.** The canned text is split into fixed-width
    character runs; each run becomes its own `content_block_delta`
    (`text_delta`) event, matching how the real API streams token
    fragments rather than one blob.
3.  **Space the frames in time.** A small, configurable delay
    (`streamChunkDelayMs`, default 5 ms) between frames — combined with
    `raw.socket.setNoDelay(true)` to defeat Nagle coalescing — is what
    makes the deltas arrive over the wire over time instead of in one
    burst.

Two options were added to `AnthropicMockOptions`: `streamChunkSize`
(characters per delta, default 16) and `streamChunkDelayMs`. A third,
`cannedResponseFile`, lets a response be loaded from a markdown fixture.

## Why this shape

- **Fidelity.** Token-fragment deltas with inter-frame delays are the
  observable behaviour clients rely on; reproducing it is the whole
  point of a mock that ships as a library.
- **Room to grow.** Owning the raw stream is the prerequisite for the
  later scenarios ADR 0001 listed — a `529` after `message_start`, a
  client disconnect mid-delta, slow tokens, backpressure. None of those
  are expressible through `reply.send()`.
- **Deterministic, verifiable.** Splitting into fixed-width character
  runs means concatenating the deltas reproduces the source text
  exactly, which the streaming tests assert. The bundled
  `src/responses/*.md` fixtures are produced by a seeded generator so
  the reassembly tests are reproducible.

## Consequences

**Positive**

- The mock now behaves like the real API on the wire, not just in event
  order.
- The raw-stream code path is in place for future fidelity scenarios.

**Negative**

- Hijacked routes own the SSE framing; Fastify’s serialization and error
  handling no longer apply, so the handler must end the response itself
  (and tear the socket down on error).
- `reply.hijack()` bypasses `inject()`’s auto-reply, so streaming is
  verified against a real listening socket (`startAnthropicMock`), not
  in-process injection.

**Neutral**

- Inter-frame delay adds a few hundred milliseconds to large canned
  responses. Defaults are tuned to keep the standalone server responsive
  while remaining observable; tests override them as needed.
