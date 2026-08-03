import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { resolve } from "node:path";

import type { FastifyInstance } from "fastify";

import { type AnthropicRequest, parseRequest } from "./schemas";
import type { AnthropicMockOptions } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_RESPONSE = "Hi! This is a canned response from anthropic-mock.";
const DEFAULT_MESSAGE_ID = "msg_mock_0001";
const DEFAULT_INPUT_TOKENS = 10;
const DEFAULT_OUTPUT_TOKENS = 1;
// Token-fragment-sized chunks mirror how the real API streams.
const DEFAULT_CHUNK_SIZE = 16;
// Combined with setNoDelay below, this delay makes deltas arrive over time
// rather than in a single burst.
const DEFAULT_CHUNK_DELAY_MS = 5;

type SseEvent = {
  readonly event: string;
  readonly data: object;
};

const DONE_FRAME = "data: [DONE]\n\n";

const serializeEvent = (event: SseEvent): string =>
  `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const resolveModel = (body: AnthropicRequest): string =>
  typeof body.model === "string" && body.model.length > 0
    ? body.model
    : DEFAULT_MODEL;

// Fixed-width runs: concatenating the deltas reproduces the text exactly,
// which the streaming tests assert.
const splitText = (text: string, size: number): readonly string[] => {
  if (size <= 0 || text.length === 0) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size)
    chunks.push(text.slice(i, i + size));
  return chunks;
};

const resolveCannedResponse = (options: AnthropicMockOptions): string => {
  if (options.cannedResponseFile)
    return readFileSync(resolve(options.cannedResponseFile), "utf8");
  return options.cannedResponse ?? DEFAULT_RESPONSE;
};

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

// Honours backpressure: if the socket buffer fills, wait for drain before
// the next frame so a long error-mode stream can't exhaust memory.
const writeFrame = async (
  raw: ServerResponse,
  event: SseEvent,
  delayMs: number,
): Promise<void> => {
  if (!raw.write(serializeEvent(event))) await once(raw, "drain");
  await sleep(delayMs);
};

const beginStream = (raw: ServerResponse): void => {
  raw.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
  });
  // Disable Nagle so each frame is pushed out immediately; otherwise small
  // frames could be coalesced and arrive as one burst, defeating the stream.
  raw.socket?.setNoDelay(true);
};

// reply.hijack() bypasses Fastify's serialization, so each write() is flushed
// to the wire on its own schedule instead of buffering into one reply body.
const streamEvents = async (
  raw: ServerResponse,
  events: readonly SseEvent[],
  delayMs: number,
): Promise<void> => {
  beginStream(raw);
  for (const event of events) await writeFrame(raw, event, delayMs);
  raw.end(DONE_FRAME);
};

// Streams deltas until errorAfterMs elapses, then tears the socket down
// mid-flight with no closing frames. Chunks cycle to fill the full window.
const streamEventsUntilError = async (
  raw: ServerResponse,
  model: string,
  chunks: readonly string[],
  inputTokens: number,
  delayMs: number,
  errorAfterMs: number,
): Promise<void> => {
  beginStream(raw);
  await writeFrame(raw, messageStartEvent(model, inputTokens), delayMs);
  await writeFrame(raw, contentBlockStartEvent(), delayMs);
  const deadline = Date.now() + errorAfterMs;
  while (Date.now() < deadline)
    for (const chunk of chunks) {
      await writeFrame(raw, textDelta(chunk), delayMs);
      if (Date.now() >= deadline) break;
    }
  raw.destroy();
};

const registerMessagesRoute = (
  app: FastifyInstance,
  options: AnthropicMockOptions,
): void => {
  const text = resolveCannedResponse(options);
  const inputTokens = options.inputTokens ?? DEFAULT_INPUT_TOKENS;
  const outputTokens = options.outputTokens ?? DEFAULT_OUTPUT_TOKENS;
  const chunkSize = options.streamChunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkDelayMs = options.streamChunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
  const errorAfterMs = options.streamErrorAfterMs;

  app.post("/v1/messages", async (request, reply) => {
    const body = parseRequest(request.body);
    const model = resolveModel(body);
    const chunks = splitText(text, chunkSize);
    reply.hijack();
    try {
      if (errorAfterMs !== undefined && errorAfterMs > 0)
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

export { registerMessagesRoute };
