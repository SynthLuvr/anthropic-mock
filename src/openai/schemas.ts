import { type } from "arktype";

const openAIRequest = type({
  "model?": "string",
  "messages?": "unknown[]",
  "stream?": "boolean",
  "max_tokens?": "number",
  "temperature?": "number",
  "tools?": "unknown[]",
});

type OpenAIRequest = typeof openAIRequest.infer;

const openAIModel = type({
  id: "string",
  object: "'model'",
  created: "number",
  owned_by: "string",
});

type OpenAIModel = typeof openAIModel.infer;

const openAIModelsResponse = type({
  object: "'list'",
  data: openAIModel.array(),
});

const chatCompletionChoice = type({
  index: "number",
  message: type({ role: "'assistant'", content: "string" }),
  finish_reason: "'stop'",
});

const chatCompletion = type({
  id: "string",
  object: "'chat.completion'",
  created: "number",
  model: "string",
  system_fingerprint: "string",
  choices: chatCompletionChoice.array(),
  usage: type({
    prompt_tokens: "number",
    completion_tokens: "number",
    total_tokens: "number",
  }),
});

const parseOpenAIRequest = (raw: unknown): OpenAIRequest => {
  const result = openAIRequest(raw);
  // A mock is deliberately lenient: a malformed body falls back to defaults
  // instead of rejecting the request.
  return result instanceof type.errors ? {} : result;
};

export type { OpenAIModel, OpenAIRequest };
export { chatCompletion, openAIModelsResponse, parseOpenAIRequest };
