import type { FastifyInstance } from "fastify";

import type { AnthropicMockOptions, AnthropicRequest } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_RESPONSE = "Hi! This is a canned response from anthropic-mock.";
const DEFAULT_MESSAGE_ID = "msg_mock_0001";
const DEFAULT_INPUT_TOKENS = 10;
const DEFAULT_OUTPUT_TOKENS = 1;

type SseEvent = {
  readonly event: string;
  readonly data: object;
};

const serializeEvents = (events: readonly SseEvent[]): string =>
  `${events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}`)
    .join("\n\n")}\n\ndata: [DONE]\n\n`;

const resolveModel = (body: AnthropicRequest): string =>
  typeof body.model === "string" && body.model.length > 0
    ? body.model
    : DEFAULT_MODEL;

const buildMessageEvents = (
  model: string,
  text: string,
  inputTokens: number,
  outputTokens: number,
): readonly SseEvent[] => [
  {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: DEFAULT_MESSAGE_ID,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        // preliminary usage; final counts arrive in message_delta
        usage: { input_tokens: inputTokens, output_tokens: 1 },
      },
    },
  },
  {
    event: "content_block_start",
    data: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
  },
  {
    event: "content_block_delta",
    data: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
  },
  {
    event: "content_block_stop",
    data: { type: "content_block_stop", index: 0 },
  },
  {
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: outputTokens },
    },
  },
  { event: "message_stop", data: { type: "message_stop" } },
];

const registerMessagesRoute = (
  app: FastifyInstance,
  options: AnthropicMockOptions,
): void => {
  const text = options.cannedResponse ?? DEFAULT_RESPONSE;
  const inputTokens = options.inputTokens ?? DEFAULT_INPUT_TOKENS;
  const outputTokens = options.outputTokens ?? DEFAULT_OUTPUT_TOKENS;

  app.post("/v1/messages", async (request, reply) => {
    const body = (request.body ?? {}) as AnthropicRequest;
    const events = buildMessageEvents(
      resolveModel(body),
      text,
      inputTokens,
      outputTokens,
    );
    return reply
      .type("text/event-stream")
      .header("cache-control", "no-cache")
      .send(serializeEvents(events));
  });
};

export { registerMessagesRoute };
