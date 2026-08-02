# Anthropic Mock

A mock implementation of the [Anthropic
API](https://docs.anthropic.com/en/api/getting-started) for testing
purposes. Stand in for the real Anthropic API in test suites so you can
exercise client code (such as [goose](https://github.com/block/goose))
without network access or API costs.

This mock implements the two endpoints goose actually calls against the
direct Anthropic API:

- `POST /v1/messages` — streaming chat completions (`"stream": true`)
- `GET /v1/models` — list available models

Responses are **canned** (fixed) for now, which keeps the mock fast,
deterministic, and dependency-free.

## Features

- **Fastify** HTTP server with the exact routes goose expects
- **SSE** `POST /v1/messages` response in the full Anthropic event
  sequence (`message_start` → `content_block_start` →
  `content_block_delta` → `content_block_stop` → `message_delta` →
  `message_stop`, terminated by `data: [DONE]`)
- **`GET /v1/models`** returning `{"data":[{"id":"..."}]}` (a `404` is
  also accepted by goose, so a working `200` is a safe default)
- **In-process** testing via Fastify’s `inject()` (no port needed)
- **Standalone** server mode for end-to-end runs and for pointing a real
  client at `ANTHROPIC_HOST`

## Design Decisions

The HTTP layer is **Fastify**, chosen over a purpose-built mock library
(Mockttp) and raw `node:http`. Fastify is the only option that gives
**true incremental streaming that is also repeatable** (via
`reply.hijack()` + `reply.raw`), at a fraction of the dependency weight,
while still supporting in-process tests via `inject()`. See [ADR
0001](./docs/decisions/0001-use-fastify-for-http-mock.md) for the full
rationale, the evidence, and the alternatives considered.

## Tech Stack

| Tool                                                             | Purpose                            |
|------------------------------------------------------------------|------------------------------------|
| [pnpm](https://pnpm.io)                                          | Package manager                    |
| [Fastify](https://fastify.dev)                                   | HTTP server for the mock           |
| [TypeScript](https://www.typescriptlang.org)                     | Type checking (`tsc --noEmit`)     |
| [Biome](https://biomejs.dev)                                     | Primary formatter and linter       |
| [oxlint](https://oxc.rs/docs/usage/linter)                       | Secondary type-aware linter        |
| [ast-grep](https://ast-grep.github.io)                           | Structural lint/format rules       |
| [convert-to-arrow](https://github.com/chimurai/convert-to-arrow) | Codemod: `function` → arrow consts |
| [Vitest](https://vitest.dev)                                     | Test runner (unit + integration)   |
| [tsx](https://github.com/privatenumber/tsx)                      | Dev-time TypeScript execution      |
| [npm-run-all2](https://github.com/bcomnes/npm-run-all2)          | Orchestrates multi-step scripts    |
| [pandoc](https://pandoc.org)                                     | Markdown formatter (GFM)           |

## Prerequisites

- [Node.js](https://nodejs.org) 26 and [pnpm](https://pnpm.io) (enforced
  via `engines`)
- [pandoc](https://pandoc.org) ≥ 3.1 — required by `pnpm lint:md` /
  `pnpm format:md`

## Quick Start

``` bash
pnpm install
pnpm build    # type-check with tsc
pnpm test     # run unit tests
pnpm start    # run the mock server on http://127.0.0.1:8787
```

## Usage

### In-process (unit tests)

`createAnthropicMock()` returns a Fastify instance with both routes
registered. Use Fastify’s `inject()` to make requests without binding a
port:

``` ts
import { createAnthropicMock } from "anthropic-mock";

const app = createAnthropicMock();

const response = await app.inject({
  method: "POST",
  url: "/v1/messages",
  payload: { model: "claude-sonnet-4-5", messages: [], stream: true },
});

console.log(response.body); // the canned SSE payload
await app.close();
```

### Standalone server (end-to-end)

`startAnthropicMock()` listens on an ephemeral (or chosen) port and
returns a `{ url, close }` handle:

``` ts
import { startAnthropicMock } from "anthropic-mock";

const mock = await startAnthropicMock();
console.log(mock.url); // http://127.0.0.1:<port>
await mock.close();
```

For a long-running process, use the `start` script (configurable via
`PORT` and `HOST` env vars, default `127.0.0.1:8787`):

``` bash
pnpm start
PORT=3000 pnpm start
```

### Pointing a client at the mock

Most Anthropic-compatible clients let you override the base host. For
goose, set `ANTHROPIC_HOST` to the mock’s URL:

``` bash
ANTHROPIC_HOST=http://127.0.0.1:8787 ANTHROPIC_API_KEY=test-key goose
```

## API

### `createAnthropicMock(options?): FastifyInstance`

Create a Fastify instance (not yet listening) with `POST /v1/messages`
and `GET /v1/models` registered. Use `app.inject()` for testing or
`app.listen()` to run it.

### `startAnthropicMock(options?): Promise<RunningAnthropicMock>`

Create a mock and start it listening. Resolves to `{ url, close }`,
where `url` is the base URL (e.g. `http://127.0.0.1:54321`).

### `AnthropicMockOptions`

| Option           | Type                | Default               | Description                                       |
|------------------|---------------------|-----------------------|---------------------------------------------------|
| `host`           | `string`            | `127.0.0.1`           | Listen host (`startAnthropicMock` only)           |
| `port`           | `number`            | `0` (ephemeral)       | Listen port (`0` lets the OS choose)              |
| `models`         | `readonly string[]` | Sonnet/Opus/Haiku 4.5 | Model ids returned by `GET /v1/models`            |
| `cannedResponse` | `string`            | Canned greeting       | Text emitted in the `content_block_delta`         |
| `inputTokens`    | `number`            | `10`                  | `usage.input_tokens` reported in `message_start`  |
| `outputTokens`   | `number`            | `1`                   | `usage.output_tokens` reported in `message_delta` |

### `RunningAnthropicMock`

| Field   | Type                  | Description                       |
|---------|-----------------------|-----------------------------------|
| `url`   | `string`              | Base URL of the running mock      |
| `close` | `() => Promise<void>` | Stop the server and free the port |

## Endpoints

### `POST /v1/messages`

Accepts a JSON request body (model, messages, system, tools, …). The
mock is lenient: it reads `model` (falling back to `claude-sonnet-4-5`)
and echoes it in the response. It always replies with a canned SSE
stream:

``` text
event: message_start
data: {"type":"message_start","message":{"id":"msg_mock_0001","role":"assistant","model":"claude-sonnet-4-5","usage":{"input_tokens":10,"output_tokens":1}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi! This is a canned response from anthropic-mock."}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}

event: message_stop
data: {"type":"message_stop"}

data: [DONE]
```

### `GET /v1/models`

Returns a list of models. Only `id` is consumed by goose:

``` json
{
  "data": [
    { "id": "claude-sonnet-4-5", "type": "model", "display_name": "claude-sonnet-4-5" },
    { "id": "claude-opus-4-5", "type": "model", "display_name": "claude-opus-4-5" },
    { "id": "claude-haiku-4-5", "type": "model", "display_name": "claude-haiku-4-5" }
  ]
}
```

## Scripts

### Build

| Script       | Description                                         |
|--------------|-----------------------------------------------------|
| `pnpm build` | Type-check the project with `tsc` (no output files) |
| `pnpm start` | Run the mock server with `tsx`                      |

### Lint

The `lint` script runs all linters in sequence via `npm-run-all`:

| Script                | Description                               |
|-----------------------|-------------------------------------------|
| `pnpm lint`           | Run all lint steps                        |
| `pnpm lint:biome`     | Biome check: format + lint + import order |
| `pnpm lint:oxlint`    | oxlint with type-aware rules              |
| `pnpm lint:exports`   | ast-grep: no inline exports               |
| `pnpm lint:functions` | ast-grep: no function declarations        |
| `pnpm lint:md`        | pandoc: Markdown must be GFM-formatted    |

### Format

The `format` script runs all formatters in sequence:

| Script               | Description                                             |
|----------------------|---------------------------------------------------------|
| `pnpm format`        | Run all format steps                                    |
| `pnpm format:arrows` | `convert-to-arrow` — rewrite `function` to arrow consts |
| `pnpm format:braces` | ast-grep strip single-statement braces                  |
| `pnpm format:biome`  | Biome format with auto-fix                              |
| `pnpm format:check`  | Biome check (lint + format auto-fix)                    |
| `pnpm format:md`     | pandoc: reformat Markdown to canonical GFM              |

### Test

| Script            | Description    |
|-------------------|----------------|
| `pnpm test`       | Run unit tests |
| `pnpm test:watch` | Watch mode     |

## Coding Conventions

These are **enforced** by the toolchain, not just preferences:

- **Arrow functions only** — no `function` declarations
  (`convert-to-arrow` + ast-grep rule)
- **Separate exports** — no inline `export` keywords (ast-grep rule)
- **Single-statement brace stripping** — `if`/`for`/`while` with one
  body line drop braces (ast-grep rule)
- **No leading file comments** — source files must not begin with a
  comment (ast-grep rule)
- **Double quotes**, 2-space indent, 80-char width, trailing commas,
  semicolons (Biome)
- **ESM only** (`"type": "module"`)
- **Markdown via pandoc** — all `.md` formatted with `pandoc -t gfm`
  (`lint:md`/`format:md`)

## Project Structure

    ├── .ast-grep/rules/       # Structural lint/format rules
    ├── .github/workflows/     # CI
    ├── docs/decisions/        # Architecture Decision Records (ADRs)
    ├── scripts/               # Tooling scripts (pandoc-md)
    ├── src/
    │   ├── index.ts           # Public exports
    │   ├── create-mock.ts     # Fastify factory + start helper
    │   ├── messages.ts        # POST /v1/messages (canned SSE)
    │   ├── models.ts          # GET /v1/models
    │   ├── server.ts          # Standalone entry point (pnpm start)
    │   ├── types.ts           # Shared types
    │   └── tests/             # Unit and integration tests
    ├── biome.json             # Biome formatter + linter config
    ├── .oxlintrc.json         # oxlint type-aware rules
    ├── tsconfig.json          # TypeScript config
    └── vitest.config.ts       # Test config
