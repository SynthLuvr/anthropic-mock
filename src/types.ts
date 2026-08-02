type AnthropicModel = {
  readonly id: string;
  readonly type: "model";
  readonly display_name: string;
};

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
};

type RunningAnthropicMock = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export type { AnthropicMockOptions, AnthropicModel, RunningAnthropicMock };
