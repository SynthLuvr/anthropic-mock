# ADR 0004: Simulate a mid-stream SSE error event (Channel B)

| Field  | Value                              |
|--------|------------------------------------|
| Status | Accepted                           |
| Date   | 2026-08-03                         |
| Tags   | architecture, http, streaming, api |

## Context

[ADR 0003](./0003-midstream-error.md) added `streamErrorAfterMs`, which
streams deltas and then tears the socket down mid-flight. That
reproduces a *transport-level* failure: the connection drops, the body
is truncated, and the client never receives a closing frame. But it is
not the only way the real Anthropic API can fail mid-stream.

Anthropic signals failures through two distinct, non-overlapping
channels:

- **Channel A — HTTP status + headers**, delivered once, *before* the
  stream body. A hard rate-limit rejection is an HTTP `429` with
  `rate_limit_error`, plus `retry-after` and the `anthropic-ratelimit-*`
  headers. This is a pre-stream signal.

- **Channel B — an SSE `error` event**, which can arrive *mid-stream*
  after a `200`. The streaming docs give the exact shape:

      event: error
      data: {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}

  The published mid-stream example is `overloaded_error` (the streaming
  counterpart of HTTP `529`). There is no dedicated `rate_limit` SSE
  event type, and — by the nature of HTTP/SSE — no new status code or
  headers can be injected into an already-open `200` body. The generic
  `error` event is the *only* mid-stream channel.

ADR 0003’s abrupt socket destruction is neither channel: it leaves the
client with an unparsable truncation, the signature of a server that
died (or a proxy that cut it off). A client must *also* be exercised
against the structured `event: error` frame — the case where the server
is alive enough to emit a well-formed error before closing the stream.
The mock could not reproduce that.

## Decision

Add three options to `AnthropicMockOptions`:

- `streamSseErrorAfterMs` — when a positive number, every
  `POST /v1/messages` response streams `message_start`,
  `content_block_start`, and a run of `content_block_delta` frames for
  that many milliseconds, then emits a single `event: error` SSE frame
  and ends the stream with `raw.end()`.
- `streamSseErrorType` — the `error.type` (default `overloaded_error`).
- `streamSseErrorMessage` — the `error.message` (default `Overloaded`).

The error frame matches Anthropic’s documented shape verbatim:

    event: error
    data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}

After the error the stream ends with **none** of the normal closing
frames (`content_block_stop`, `message_delta`, `message_stop`) and no
`data: [DONE]` sentinel: the error is terminal and supersedes successful
completion.

The delta-cycling loop is shared with `streamErrorAfterMs` (ADR 0003)
via an extracted `streamDeltasUntil` helper; the two paths differ only
in how they terminate (abrupt `destroy()` vs. a structured frame + a
clean `end()`).

## Why this shape

- **Fidelity to the only mid-stream channel.** Once the `200` is sent,
  the status and headers are immutable; a structured failure can reach
  the client only as an `event: error` SSE frame. Emitting exactly that
  frame is what reproduces the real on-the-wire behaviour.
- **Complementary to ADR 0003.** Abrupt truncation and a structured
  error are different failure modes that exercise different client code
  paths (truncation recovery vs. error-type handling). Keeping both —
  and giving them distinct option names — lets a test choose the
  fidelity it needs.
- **Generic error type.** Anthropic’s only published mid-stream example
  is `overloaded_error`, but token limits are *“evaluated in real time
  as output tokens are produced,”* so a stream can conceptually trip a
  limit mid-flight. Making `error.type` configurable (defaulting to the
  documented value) avoids over-fitting to one example.
- **Duration-driven.** As with ADR 0003, controlling the failure by
  elapsed time decouples the simulation from the canned text length.

## Consequences

**Positive**

- The mock can now reproduce the structured mid-stream failure mode —
  the case where the server emits a parseable `event: error` after a
  `200` — enabling client tests for error-type handling and graceful
  stream termination.
- Both failure modes share a single, backpressure-safe delta loop.

**Negative**

- `streamSseErrorAfterMs` and `streamErrorAfterMs` are mutually
  exclusive (only one termination makes sense per response). The handler
  applies Channel B first if both are set, but a test should set only
  one.

**Neutral**

- When enabled, Channel B applies to *every* `/v1/messages` request,
  consistent with the existing per-instance option model.
