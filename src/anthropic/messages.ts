import type { ServerResponse } from "node:http";

import type { FastifyInstance } from "fastify";

import {
  resolveCannedResponse,
  resolveModel,
  type SseEvent,
  splitText,
  streamEvents,
  streamOpeningThenDeltas,
  writeFrame,
} from "../sse";
import type { AnthropicMockOptions } from "../types";
import { parseAnthropicRequest } from "./schemas";

const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_MESSAGE_ID = "msg_mock_0001";
const DEFAULT_INPUT_TOKENS = 10;
const DEFAULT_OUTPUT_TOKENS = 1;
// Token-fragment-sized chunks mirror how the real API streams.
const DEFAULT_CHUNK_SIZE = 16;
// Combined with setNoDelay below, this delay makes deltas arrive over time
// rather than in a single burst.
const DEFAULT_CHUNK_DELAY_MS = 5;

const textDelta = (text: string): SseEvent => ({
  event: "content_block_delta",
  data: {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  },
});

const messageStartEvent = (model: string, inputTokens: number): SseEvent => ({
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
});

const contentBlockStartEvent = (): SseEvent => ({
  event: "content_block_start",
  data: {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  },
});

const contentBlockStopEvent = (): SseEvent => ({
  event: "content_block_stop",
  data: { type: "content_block_stop", index: 0 },
});

const messageDeltaEvent = (outputTokens: number): SseEvent => ({
  event: "message_delta",
  data: {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: outputTokens },
  },
});

const messageStopEvent = (): SseEvent => ({
  event: "message_stop",
  data: { type: "message_stop" },
});

// Channel B: the structured SSE error frame the real API emits mid-stream
// after a 200 — its only mid-stream error channel (ADR 0004).
const sseErrorEvent = (errorType: string, errorMessage: string): SseEvent => ({
  event: "error",
  data: {
    type: "error",
    error: { type: errorType, message: errorMessage },
  },
});

const buildMessageEvents = (
  model: string,
  chunks: readonly string[],
  inputTokens: number,
  outputTokens: number,
): readonly SseEvent[] => [
  messageStartEvent(model, inputTokens),
  contentBlockStartEvent(),
  ...chunks.map(textDelta),
  contentBlockStopEvent(),
  messageDeltaEvent(outputTokens),
  messageStopEvent(),
];

// Channel A (transport): streams opening frames and deltas, then tears the
// socket down mid-flight with no closing frames — a truncated mid-stream error.
const streamEventsUntilError = async (
  raw: ServerResponse,
  model: string,
  chunks: readonly string[],
  inputTokens: number,
  delayMs: number,
  errorAfterMs: number,
): Promise<void> => {
  await streamOpeningThenDeltas(
    raw,
    [messageStartEvent(model, inputTokens), contentBlockStartEvent()],
    textDelta,
    chunks,
    delayMs,
    errorAfterMs,
  );
  raw.destroy();
};

// Channel B (SSE): streams opening frames and deltas, then emits a structured
// `event: error` frame and ends cleanly — a parseable mid-stream error.
const streamEventsUntilSseError = async (
  raw: ServerResponse,
  model: string,
  chunks: readonly string[],
  inputTokens: number,
  delayMs: number,
  errorAfterMs: number,
  errorType: string,
  errorMessage: string,
): Promise<void> => {
  await streamOpeningThenDeltas(
    raw,
    [messageStartEvent(model, inputTokens), contentBlockStartEvent()],
    textDelta,
    chunks,
    delayMs,
    errorAfterMs,
  );
  await writeFrame(raw, sseErrorEvent(errorType, errorMessage), delayMs);
  raw.end();
};

const registerAnthropicMessagesRoute = (
  app: FastifyInstance,
  options: AnthropicMockOptions,
): void => {
  const text = resolveCannedResponse(options);
  const inputTokens = options.inputTokens ?? DEFAULT_INPUT_TOKENS;
  const outputTokens = options.outputTokens ?? DEFAULT_OUTPUT_TOKENS;
  const chunkSize = options.streamChunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkDelayMs = options.streamChunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
  const errorAfterMs = options.streamErrorAfterMs;
  const sseErrorAfterMs = options.streamSseErrorAfterMs;
  const sseErrorType = options.streamSseErrorType ?? "overloaded_error";
  const sseErrorMessage = options.streamSseErrorMessage ?? "Overloaded";

  app.post("/v1/messages", async (request, reply) => {
    const body = parseAnthropicRequest(request.body);
    const model = resolveModel(body, DEFAULT_MODEL);
    const chunks = splitText(text, chunkSize);
    reply.hijack();
    try {
      if (sseErrorAfterMs !== undefined && sseErrorAfterMs > 0)
        await streamEventsUntilSseError(
          reply.raw,
          model,
          chunks,
          inputTokens,
          chunkDelayMs,
          sseErrorAfterMs,
          sseErrorType,
          sseErrorMessage,
        );
      else if (errorAfterMs !== undefined && errorAfterMs > 0)
        await streamEventsUntilError(
          reply.raw,
          model,
          chunks,
          inputTokens,
          chunkDelayMs,
          errorAfterMs,
        );
      else
        await streamEvents(
          reply.raw,
          buildMessageEvents(model, chunks, inputTokens, outputTokens),
          chunkDelayMs,
        );
    } catch {
      // Hijacked replies have no error path; just tear the socket down.
      reply.raw.destroy();
    }
  });
};

export { registerAnthropicMessagesRoute };
