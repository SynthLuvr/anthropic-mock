import type { ServerResponse } from "node:http";

import type { FastifyInstance } from "fastify";

import {
  resolveCannedResponse,
  resolveModel,
  type SseEvent,
  sleep,
  splitText,
  streamEvents,
  streamOpeningThenDeltas,
  writeFrame,
} from "../sse";
import type { OpenAIMockOptions } from "../types";
import { parseOpenAIRequest } from "./schemas";

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_COMPLETION_ID = "chatcmpl-mock-0001";
// Fixed epoch and fingerprint keep every response byte-for-byte
// deterministic, which the tests assert.
const DEFAULT_CREATED = 1735689600;
const DEFAULT_FINGERPRINT = "fp_llm_mock_0000";
const DEFAULT_INPUT_TOKENS = 10;
const DEFAULT_OUTPUT_TOKENS = 1;
// Token-fragment-sized chunks mirror how the real API streams.
const DEFAULT_CHUNK_SIZE = 16;
// Combined with setNoDelay in beginStream, this delay makes deltas arrive
// over time rather than in a single burst.
const DEFAULT_CHUNK_DELAY_MS = 5;
const DEFAULT_SSE_ERROR_TYPE = "server_error";
const DEFAULT_SSE_ERROR_MESSAGE =
  "The server had an error while processing your request. Sorry about that!";

type ChunkMeta = {
  readonly id: string;
  readonly created: number;
  readonly model: string;
  readonly fingerprint: string;
};

// OpenAI streams `chat.completion.chunk` objects whose only varying parts
// are the delta payload and the finish reason.
const chunkEnvelope = (
  meta: ChunkMeta,
  delta: object,
  finishReason: string | null,
): SseEvent => ({
  data: {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    system_fingerprint: meta.fingerprint,
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
  },
});

// The first chunk opens the assistant turn; subsequent chunks carry content.
const roleChunk = (meta: ChunkMeta): SseEvent =>
  chunkEnvelope(meta, { role: "assistant", content: "" }, null);

const contentChunk = (meta: ChunkMeta, text: string): SseEvent =>
  chunkEnvelope(meta, { content: text }, null);

// The terminal chunk carries no delta, only the stop signal.
const stopChunk = (meta: ChunkMeta): SseEvent =>
  chunkEnvelope(meta, {}, "stop");

// The structured error object the real API delivers — as a mid-stream
// `data:` frame after a 200, or as the body of an HTTP error response.
const openAIError = (errorType: string, errorMessage: string) => ({
  error: { message: errorMessage, type: errorType, param: null, code: null },
});

const sseErrorEvent = (errorType: string, errorMessage: string): SseEvent => ({
  data: openAIError(errorType, errorMessage),
});

const buildStreamEvents = (
  meta: ChunkMeta,
  chunks: readonly string[],
): readonly SseEvent[] => [
  roleChunk(meta),
  ...chunks.map((text) => contentChunk(meta, text)),
  stopChunk(meta),
];

const chatCompletionBody = (
  meta: ChunkMeta,
  text: string,
  inputTokens: number,
  outputTokens: number,
) => ({
  id: meta.id,
  object: "chat.completion",
  created: meta.created,
  model: meta.model,
  system_fingerprint: meta.fingerprint,
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: text },
      logprobs: null,
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  },
});

// Transport error: streams opening chunks and deltas, then tears the socket
// down mid-flight with no closing chunk or [DONE] — a truncated response.
const streamEventsUntilError = async (
  raw: ServerResponse,
  meta: ChunkMeta,
  chunks: readonly string[],
  delayMs: number,
  errorAfterMs: number,
): Promise<void> => {
  await streamOpeningThenDeltas(
    raw,
    [roleChunk(meta)],
    (text) => contentChunk(meta, text),
    chunks,
    delayMs,
    errorAfterMs,
  );
  raw.destroy();
};

// SSE error: streams opening chunks and deltas, then emits a structured
// `data: {"error": ...}` frame and ends cleanly — a parseable error.
const streamEventsUntilSseError = async (
  raw: ServerResponse,
  meta: ChunkMeta,
  chunks: readonly string[],
  delayMs: number,
  errorAfterMs: number,
  errorType: string,
  errorMessage: string,
): Promise<void> => {
  await streamOpeningThenDeltas(
    raw,
    [roleChunk(meta)],
    (text) => contentChunk(meta, text),
    chunks,
    delayMs,
    errorAfterMs,
  );
  await writeFrame(raw, sseErrorEvent(errorType, errorMessage), delayMs);
  raw.end();
};

// Error modes apply to non-streaming requests too, mapped to the closest
// non-streaming analogue: the request fails with the error object as an
// HTTP 500 body after the configured delay. The SSE error takes precedence
// when both modes are configured, mirroring the streaming branch.
const errorDelayMs = (options: OpenAIMockOptions): number | undefined => {
  const { streamSseErrorAfterMs, streamErrorAfterMs } = options;
  if (streamSseErrorAfterMs !== undefined && streamSseErrorAfterMs > 0)
    return streamSseErrorAfterMs;
  if (streamErrorAfterMs !== undefined && streamErrorAfterMs > 0)
    return streamErrorAfterMs;
  return undefined;
};

const registerOpenAIChatCompletionsRoute = (
  app: FastifyInstance,
  options: OpenAIMockOptions,
): void => {
  const text = resolveCannedResponse(options);
  const inputTokens = options.inputTokens ?? DEFAULT_INPUT_TOKENS;
  const outputTokens = options.outputTokens ?? DEFAULT_OUTPUT_TOKENS;
  const chunkSize = options.streamChunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkDelayMs = options.streamChunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
  const errorAfterMs = options.streamErrorAfterMs;
  const sseErrorAfterMs = options.streamSseErrorAfterMs;
  const sseErrorType = options.streamSseErrorType ?? DEFAULT_SSE_ERROR_TYPE;
  const sseErrorMessage =
    options.streamSseErrorMessage ?? DEFAULT_SSE_ERROR_MESSAGE;

  app.post("/v1/chat/completions", async (request, reply) => {
    const body = parseOpenAIRequest(request.body);
    const model = resolveModel(body, DEFAULT_MODEL);
    const meta: ChunkMeta = {
      id: DEFAULT_COMPLETION_ID,
      created: DEFAULT_CREATED,
      model,
      fingerprint: DEFAULT_FINGERPRINT,
    };
    const chunks = splitText(text, chunkSize);

    if (body.stream) {
      reply.hijack();
      try {
        if (sseErrorAfterMs !== undefined && sseErrorAfterMs > 0)
          await streamEventsUntilSseError(
            reply.raw,
            meta,
            chunks,
            chunkDelayMs,
            sseErrorAfterMs,
            sseErrorType,
            sseErrorMessage,
          );
        else if (errorAfterMs !== undefined && errorAfterMs > 0)
          await streamEventsUntilError(
            reply.raw,
            meta,
            chunks,
            chunkDelayMs,
            errorAfterMs,
          );
        else
          await streamEvents(
            reply.raw,
            buildStreamEvents(meta, chunks),
            chunkDelayMs,
          );
      } catch {
        // Hijacked replies have no error path; just tear the socket down.
        reply.raw.destroy();
      }
      return;
    }

    // Non-streaming (the OpenAI default): one JSON chat.completion.
    const failureAfterMs = errorDelayMs(options);
    if (failureAfterMs !== undefined) {
      await sleep(failureAfterMs);
      return reply.code(500).send(openAIError(sseErrorType, sseErrorMessage));
    }
    return reply.send(
      chatCompletionBody(meta, text, inputTokens, outputTokens),
    );
  });
};

export { registerOpenAIChatCompletionsRoute };
