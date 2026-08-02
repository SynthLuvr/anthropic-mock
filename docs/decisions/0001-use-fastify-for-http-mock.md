# ADR 0001: Use Fastify as the HTTP layer for the mock

| Field  | Value                                     |
|--------|-------------------------------------------|
| Status | Accepted                                  |
| Date   | 2026-08-02                                |
| Tags   | architecture, http, testing, dependencies |

## Context

The mock must stand in for the **direct Anthropic API** as seen by
[goose](https://github.com/block/goose), a Rust binary that talks to
`https://api.anthropic.com` over the real network. Goose is pointed at
the mock through `ANTHROPIC_HOST`, so the mock has to be a **real,
standalone HTTP server** listening on a port. This single requirement
rules out in-process HTTP interceptors such as
[nock](https://github.com/nock/nock) or [MSW](https://mswjs.io/), which
patch the HTTP client *inside one Node process* and therefore cannot
serve a request that originates from an external binary.

The server needs exactly two routes, both verified against goose’s
source:

- `POST /v1/messages` — a Server-Sent Events (SSE) stream emitting the
  full Anthropic event sequence (`message_start` → `content_block_start`
  → `content_block_delta` → `content_block_stop` → `message_delta` →
  `message_stop`, terminated by `data: [DONE]`).
- `GET /v1/models` — a JSON list of models
  (`{ "data": [{ "id": "…"   }] }`; a `404` is also tolerated).

Both routes must accept the `x-api-key` and `anthropic-version` headers,
and the mock must be able to reproduce the status-code matrix goose
retries on (`401`/`403`, `404`, `413`, `429` with `Retry-After`, `5xx`).

Beyond “make it work today”, this is a **library** published for other
projects to consume as a `devDependency`. That raises the bar on two
counts: its dependency weight is paid by every consumer, and its value
grows with how faithfully it can simulate the real API’s streaming
behaviour (mid-stream errors, cancellation, backpressure, slow token
delivery) — not just how well it echoes canned bodies.

## Decision

Use **[Fastify](https://fastify.dev) 5** as the HTTP layer. The mock
factory (`createAnthropicMock`) returns a `FastifyInstance` that has
both routes registered. This gives us two modes from one framework:

- **In-process** — Fastify’s `inject()` dispatches requests without
  binding a port, which is what the unit-test suite uses.
- **Standalone** — `app.listen({ port: 0 })` binds a real port for
  end-to-end runs and for pointing goose (or any Anthropic client) at
  `ANTHROPIC_HOST`.

## Why Fastify over the alternatives

The candidates were narrowed to three: a purpose-built HTTP mock library
(**Mockttp**), the framework we chose (**Fastify**), and raw
**`node:http`**. The evaluation below is based on running
proof-of-concept servers against each on Node 26, not on documentation
claims.

### Fastify (chosen)

- **True streaming that is also repeatable.** With `reply.hijack()` we
  write the SSE stream directly to `reply.raw` and flush each event on
  its own schedule. A PoC measured ~40 ms gaps between consecutive
  events *and* served the same route a second time without error.
- **Lightweight.** ~14 MB / ~41 packages installed, a fraction of a mock
  library’s footprint.
- **Full fidelity control.** Owning the raw stream means we can later
  simulate scenarios the real API produces — a `529` after
  `message_start`, a client disconnect mid-`content_block_delta`, slow
  tokens, backpressure — none of which a canned-response mock can
  express.
- **Typed and ergonomic.** First-class TypeScript types, a plugin model,
  JSON serialization, and lifecycle hooks out of the box.
- **One framework, two modes.** `inject()` for fast unit tests,
  `listen()` for standalone runs.

### Mockttp 4.6.0 (considered, rejected)

A purpose-built mock library that satisfies every *functional*
requirement and would have been the conventional choice. It was rejected
on two empirical grounds:

- **Streaming is capped.** Mockttp offers two response modes.
  `thenCallback` returns a buffered body — repeatable across requests,
  but the whole SSE payload arrives in one burst. `thenStream` delivers
  a truly incremental stream, but it is **one-shot**: the second request
  to the same route fails with `HTTP 500` (“Stream request step called
  more than once”). You cannot have true streaming *and* repeatability
  at once, and neither mode can express mid-stream errors or
  cancellation. For a fidelity mock that is a deal-breaker.
- **Heavier.** ~42 MB / ~201 transitive packages — roughly 3× the disk
  and 5× the package count of Fastify. For a library that ships to
  consumers, that cost is hard to justify when it buys less capability.

Mockttp’s genuine advantages — built-in `getSeenRequests()` request
assertions, matchers, and TLS — were not enough to outweigh those two
gaps. Its request-recording helper is reproducible in ~15 lines against
a Fastify `onRequest` hook should we need it.

### Raw `node:http` (considered, not chosen)

The lightest possible option: zero dependencies and complete control of
`res`. It remains a credible fallback if footprint ever becomes the
dominant concern. It was set aside because it shifts real work onto us —
hand-rolled routing, JSON serialization, lifecycle hooks, and a parallel
path to support in-process testing (raw `http` has no `inject()`
equivalent). Fastify is essentially raw `node:http` plus those niceties,
so we take the ergonomics for the modest cost of ~14 MB.

### In-process interceptor libraries (nock, MSW, sinon)

The conventional “mock an HTTP API” tools —
[nock](https://github.com/nock/nock), [MSW](https://mswjs.io/), and
[sinon](https://sinonjs.org/)’s fake server — were considered and
eliminated. They all work by **patching the HTTP client inside a single
Node process**: nock intercepts the `http`/`https` modules, MSW
intercepts requests via service-worker-style handlers, and sinon fakes
`XMLHttpRequest`/`fetch`. None of them is a real server, so none can
serve a request that originates from **goose, an external binary
connecting over the real network**. That standalone-server requirement
disqualifies all three regardless of any other capability.

SSE does not rescue them, and in some cases is unavailable outright.
Their streaming support is scoped to in-process interception: sinon’s
fake server has no real streaming; nock can reply with a stream and MSW
now supports SSE via `ReadableStream`, but only for requests it can
intercept in-process. Since an interceptor cannot serve an external
client to begin with, its SSE support cannot reach goose. This confirms
they were not a fit for a fidelity mock that must stream over a real
socket.

## Consequences

**Positive**

- One framework serves both in-process (`inject()`) and standalone
  (`listen()`) use, so the test suite and end-to-end runs share a code
  path.
- Full byte-level control of the SSE stream leaves room to add fidelity
  scenarios later without re-architecting.
- A single, well-supported runtime dependency keeps the consumer burden
  small.

**Negative**

- The mock now carries Fastify (and its transitive dependencies) as a
  runtime dependency; consumers must run in a Node context. This is
  acceptable because the Anthropic API is itself server-side.
- Streaming scenarios use `reply.hijack()`, which bypasses Fastify’s
  serialization — we own the SSE framing for those routes.

**Neutral**

- Mockttp-style request recording is available on demand via a small
  hook rather than built in.
