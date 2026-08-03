# ADR 0003: Simulate a mid-stream error after a configurable duration

| Field  | Value                              |
|--------|------------------------------------|
| Status | Accepted                           |
| Date   | 2026-08-02                         |
| Tags   | architecture, http, streaming, api |

## Context

[ADR 0002](./0002-incremental-streaming.md) shipped genuine incremental
streaming over the raw socket and called out the scenarios that owning
the stream makes possible — among them *“a mid-stream error after
`message_start`”* and *“a `529` after `message_start`”*. Both remained
unimplemented.

Clients of the Anthropic API must handle the case where a stream that
began successfully dies mid-flight: the server returns `200`, starts
emitting `content_block_delta` frames, and then hits a `500`-class error
(or is torn down by an upstream proxy). From the client’s side the
connection simply drops with a partial payload — no
`content_block_stop`, no `message_stop`, no `[DONE]` — so the assembled
message is truncated and unparsable. A fidelity mock that cannot
reproduce this failure mode cannot exercise a client’s recovery, retry,
or partial-response handling.

## Decision

Add an option, `streamErrorAfterMs`, to `AnthropicMockOptions`. When it
is a positive number, every `POST /v1/messages` response:

1.  **Writes the opening frames.** `message_start` and
    `content_block_start` go out as usual, so the stream genuinely
    begins and the client commits to a streaming response.
2.  **Streams deltas for the configured duration.**
    `content_block_delta` frames are written on the same
    `streamChunkDelayMs` cadence as the normal path, repeating the
    canned text so data flows for the whole window even when the
    response is short.
3.  **Tears the socket down mid-flight.** Once the deadline elapses the
    raw socket is `destroy()`ed. No `content_block_stop`,
    `message_delta`, `message_stop`, or `[DONE]` frame is ever written,
    so the client is left with a truncated, unparsable SSE body — the
    on-the-wire signature of a server that died mid-stream.

Backpressure is honoured (`await once(raw, "drain")` when a write
returns `false`), so a long window with a tiny inter-frame delay cannot
exhaust memory buffering frames the socket has not flushed.

## Why this shape

- **Fidelity.** The defining behaviour of a mid-stream `500` is not the
  status code (once the `200` headers are sent the status can no longer
  change) but the *abrupt truncation*. Destroying the socket after a
  burst of deltas reproduces exactly what a crashing server looks like
  on the wire, and is what client error paths actually key off.
- **Duration-driven.** Controlling the failure by elapsed time (rather
  than by a fixed number of frames) decouples the simulation from the
  canned text length and chunk size: the stream runs for *as long as the
  test wants*, then fails.
- **Reuses the raw-stream path.** The feature is a variant of the
  existing `reply.hijack()` writer; it adds no dependencies and shares
  the frame/event helpers with the happy path.

## Consequences

**Positive**

- The mock can now exercise the client failure paths ADR 0002
  anticipated: abrupt mid-stream disconnect, partial-response handling,
  and “stream ended without `[DONE]`” recovery.
- The happy path is untouched when `streamErrorAfterMs` is unset.

**Negative**

- A hijacked reply that is destroyed has no Fastify error path; the
  handler tears the socket down directly, so transport-level errors are
  not surfaced as structured HTTP errors (which is the point).
- Abrupt socket destruction is OS-dependent in whether the client sees a
  clean `FIN` (reader resolves `done`) or a connection reset (reader
  rejects). Client test code must tolerate both.

**Neutral**

- When enabled the option applies to *every* `/v1/messages` request; a
  test that needs both success and failure streams uses two server
  instances, consistent with the existing per-instance option model.
