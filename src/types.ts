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
  // When set, every /v1/messages stream emits deltas for this many
  // milliseconds and then tears the socket down mid-flight — no
  // content_block_stop / message_stop / [DONE] — leaving the client with
  // a truncated, unparsable response. Simulates a mid-stream 500-class
  // server error.
  readonly streamErrorAfterMs?: number;
};

type RunningAnthropicMock = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export type { AnthropicMockOptions, RunningAnthropicMock };
