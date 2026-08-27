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
  // Observes every request just before its route handler runs — after
  // the URL and body are final — so a test can assert which endpoints
  // a client actually called (the standalone server wires this to
  // LLM_MOCK_LOG).
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
};

type RunningMock = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export type { MockOptions, MockRequest, RunningMock };
