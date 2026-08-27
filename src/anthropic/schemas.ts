import { type } from "arktype";

const anthropicRequest = type({
  "model?": "string",
  "messages?": "unknown[]",
  "max_tokens?": "number",
  "stream?": "boolean",
  "system?": "unknown",
  "temperature?": "number",
  "tools?": "unknown[]",
});

type AnthropicRequest = typeof anthropicRequest.infer;

const anthropicModel = type({
  id: "string",
  type: "'model'",
  display_name: "string",
});

type AnthropicModel = typeof anthropicModel.infer;

const anthropicModelsResponse = type({ data: anthropicModel.array() });

const parseAnthropicRequest = (raw: unknown): AnthropicRequest => {
  const result = anthropicRequest(raw);
  // A mock is deliberately lenient: a malformed body falls back to defaults
  // instead of rejecting the request.
  return result instanceof type.errors ? {} : result;
};

export type { AnthropicModel, AnthropicRequest };
export { anthropicModelsResponse, parseAnthropicRequest };
