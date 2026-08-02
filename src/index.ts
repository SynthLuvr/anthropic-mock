type AnthropicMock = {
  readonly url: string;
};

const createAnthropicMock = (url = "/v1/messages"): AnthropicMock => ({
  url,
});

export type { AnthropicMock };
export { createAnthropicMock };
