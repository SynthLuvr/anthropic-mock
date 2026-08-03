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
  // Channel B: when set, streams deltas for this many milliseconds, then
  // emits a structured SSE `event: error` frame and ends the stream cleanly.
  // Unlike streamErrorAfterMs (an abrupt transport drop), this delivers a
  // parseable error event after the 200, mirroring the real API's only
  // mid-stream error channel.
  readonly streamSseErrorAfterMs?: number;
  // The error.type inside the SSE error event (default "overloaded_error",
  // the only mid-stream example Anthropic documents).
  readonly streamSseErrorType?: string;
  // The error.message inside the SSE error event (default "Overloaded").
  readonly streamSseErrorMessage?: string;
};

type RunningAnthropicMock = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export type { AnthropicMockOptions, RunningAnthropicMock };
