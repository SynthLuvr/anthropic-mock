import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { resolve } from "node:path";

import type { MockOptions } from "./types";

const DEFAULT_RESPONSE = "Hi! This is a canned response from llm-mock.";

// Anthropic frames name their event (`event:` + `data:` lines); OpenAI
// frames carry `data:` lines only. The event name is optional so one
// serializer serves both wire formats.
type SseEvent = {
  readonly event?: string;
  readonly data: object;
};

const DONE_FRAME = "data: [DONE]\n\n";

const serializeEvent = (event: SseEvent): string =>
  event.event === undefined
    ? `data: ${JSON.stringify(event.data)}\n\n`
    : `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const resolveModel = (
  body: { readonly model?: string },
  fallback: string,
): string =>
  typeof body.model === "string" && body.model.length > 0
    ? body.model
    : fallback;

// Fixed-width runs: concatenating the deltas reproduces the text exactly,
// which the streaming tests assert.
const splitText = (text: string, size: number): readonly string[] => {
  if (size <= 0 || text.length === 0) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size)
    chunks.push(text.slice(i, i + size));
  return chunks;
};

const resolveCannedResponse = (options: MockOptions): string => {
  if (options.cannedResponseFile)
    return readFileSync(resolve(options.cannedResponseFile), "utf8");
  return options.cannedResponse ?? DEFAULT_RESPONSE;
};

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

// Opens the stream, writes the opening frames, then cycles the canned text
// as deltas for `durationMs` — the shared body of both mid-stream failure
// paths, which differ only in how they terminate.
const streamOpeningThenDeltas = async (
  raw: ServerResponse,
  opening: readonly SseEvent[],
  deltaEvent: (text: string) => SseEvent,
  chunks: readonly string[],
  delayMs: number,
  durationMs: number,
): Promise<void> => {
  beginStream(raw);
  for (const event of opening) await writeFrame(raw, event, delayMs);
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline)
    for (const chunk of chunks) {
      await writeFrame(raw, deltaEvent(chunk), delayMs);
      if (Date.now() >= deadline) break;
    }
};

export type { SseEvent };
export {
  beginStream,
  DONE_FRAME,
  resolveCannedResponse,
  resolveModel,
  sleep,
  splitText,
  streamEvents,
  streamOpeningThenDeltas,
  writeFrame,
};
