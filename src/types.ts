import type { MockRule } from "./rules/types";

type MockRequest = {
  readonly method: string;
  readonly url: string;
};

type MockOptions = {
  readonly host?: string;
  readonly port?: number;
  readonly models?: readonly string[];
  readonly cannedResponse?: string;
  readonly cannedResponseFile?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly streamChunkSize?: number;
  readonly streamChunkDelayMs?: number;
  // Observes each request just before its route handler runs; the
  // standalone server wires this to LLM_MOCKINGBIRD_LOG.
  readonly onRequest?: (request: MockRequest) => void;
  // When set, streams deltas for this many milliseconds then tears the
  // socket down mid-flight (no closing frames) — a mid-stream 500-class
  // transport error.
  readonly streamErrorAfterMs?: number;
  // When set, streams deltas for this many milliseconds, then emits a
  // structured SSE error frame and ends the stream cleanly — a parseable
  // mid-stream error after the 200 (Anthropic Channel B, ADR 0004; the
  // OpenAI equivalent is a `data: {"error": ...}` frame).
  readonly streamSseErrorAfterMs?: number;
  // The error type inside the mid-stream SSE error frame. Anthropic
  // default: "overloaded_error"; OpenAI default: "server_error".
  readonly streamSseErrorType?: string;
  // The error message inside the mid-stream SSE error frame. Anthropic
  // default: "Overloaded"; OpenAI default: "The server had an error while
  // processing your request. Sorry about that!".
  readonly streamSseErrorMessage?: string;
  // When set, streams opening frames and deltas for this many milliseconds,
  // then stalls: the stream stays open indefinitely with no closing frames
  // and no error. This reproduces a provider that accepts the request,
  // streams some content, and then wedges — the client is left waiting on a
  // response that never arrives and never fails.
  readonly streamStallAfterMs?: number;
  // How often to emit `: ping` comment lines while stalled. Comment lines
  // are legal SSE frames that carry no data, so event-driven clients see
  // pure silence while byte-level read timeouts are defeated because bytes
  // keep arriving. Defaults to 500ms; 0 leaves the socket fully silent.
  readonly streamStallKeepaliveMs?: number;
  // Config-driven behavior (ADR 0008): the first rule matching a completion
  // request supplies its reply or fault, replacing the canned response.
  readonly rules?: readonly MockRule[];
  // The reply for requests no rule matches — llm-mock's defaults.fallback.
  // Takes precedence over the canned response; the canned text stays the
  // ultimate default when this is unset.
  readonly fallbackResponse?: string;
};

type RunningMock = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export type { MockOptions, MockRequest, RunningMock };
