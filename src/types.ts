type AnthropicMockOptions = {
  readonly host?: string;
  readonly port?: number;
  readonly models?: readonly string[];
  readonly cannedResponse?: string;
  readonly cannedResponseFile?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly streamChunkSize?: number;
  readonly streamChunkDelayMs?: number;
  // When set, streams deltas for this many milliseconds then tears the
  // socket down mid-flight (no closing frames) — a mid-stream 500-class error.
  readonly streamErrorAfterMs?: number;
  // When set, streams deltas for this many milliseconds, then emits a
  // structured SSE `event: error` frame and ends the stream cleanly — a
  // parseable mid-stream error after the 200 (Channel B; ADR 0004).
  readonly streamSseErrorAfterMs?: number;
  // The error.type in the SSE error event (default "overloaded_error").
  readonly streamSseErrorType?: string;
  // The error.message in the SSE error event (default "Overloaded").
  readonly streamSseErrorMessage?: string;
};

type RunningAnthropicMock = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export type { AnthropicMockOptions, RunningAnthropicMock };
