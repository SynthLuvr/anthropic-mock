import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type } from "arktype";
import { describe, expect, it } from "vitest";

import { startTestServer } from "./helpers";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const RESPONSES_DIR = join(TESTS_DIR, "..", "responses");

const readResponse = (name: string): string =>
  readFileSync(join(RESPONSES_DIR, name), "utf8");

const postMessages = (url: string): Promise<Response> =>
  fetch(`${url}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1024,
      stream: true,
    }),
  });

type SseEvent = { readonly event: string; readonly data: string };

const parseEvents = (body: string): readonly SseEvent[] => {
  const events: SseEvent[] = [];
  for (const block of body.split("\n\n")) {
    const lines = block.split("\n");
    const eventLine = lines.find((line) => line.startsWith("event: "));
    const dataLine = lines.find((line) => line.startsWith("data: "));
    if (eventLine && dataLine)
      events.push({
        event: eventLine.slice("event: ".length),
        data: dataLine.slice("data: ".length),
      });
  }
  return events;
};

const textDeltaPayload = type({ delta: { text: "string" } });

const deltaText = (events: readonly SseEvent[]): string =>
  events
    .filter((event) => event.event === "content_block_delta")
    .map((event) => textDeltaPayload.assert(JSON.parse(event.data)).delta.text)
    .join("");

const deltaCount = (events: readonly SseEvent[]): number =>
  events.filter((event) => event.event === "content_block_delta").length;

type Read = { readonly elapsed: number; readonly text: string };

const drain = async (
  response: Response,
): Promise<{
  readonly reads: readonly Read[];
  readonly body: string;
}> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const start = Date.now();
  const reads: Read[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text.length > 0) reads.push({ elapsed: Date.now() - start, text });
  }
  return { reads, body: reads.map((read) => read.text).join("") };
};

const streamBody = async (url: string): Promise<string> => {
  const response = await postMessages(url);
  const { body } = await drain(response);
  return body;
};

describe("POST /v1/messages incremental streaming (integration)", () => {
  it("delivers the stream over time rather than as a single burst", async () => {
    const server = await startTestServer({
      cannedResponse: readResponse("recipe.md"),
      streamChunkSize: 8,
      streamChunkDelayMs: 6,
    });

    const response = await postMessages(server.url);
    const { reads, body } = await drain(response);
    await server.close();

    expect(reads.length).toBeGreaterThan(1);
    // The terminal `[DONE]` and `message_stop` frames are written last. If
    // the whole body had been buffered and sent at once, the first read
    // would already contain them — so their absence proves the stream is
    // genuinely incremental.
    expect(reads[0]!.text).not.toContain("message_stop");
    expect(reads[0]!.text).not.toContain("[DONE]");
    expect(body).toContain("[DONE]");
    // Frames are spread across time, not delivered in a single tick.
    const first = reads[0]!.elapsed;
    const last = reads[reads.length - 1]!.elapsed;
    expect(last - first).toBeGreaterThanOrEqual(5);
  });

  it("reassembles chunked text deltas back into the source markdown", async () => {
    const content = readResponse("essay.md");
    const server = await startTestServer({
      cannedResponse: content,
      streamChunkSize: 12,
    });
    const body = await streamBody(server.url);
    await server.close();

    const events = parseEvents(body);
    expect(deltaCount(events)).toBeGreaterThan(1);
    expect(deltaText(events)).toBe(content);
  });

  it("emits more deltas as the chunk size shrinks", async () => {
    const content = readResponse("greeting.md");

    const fine = await startTestServer({
      cannedResponse: content,
      streamChunkSize: 4,
      streamChunkDelayMs: 0,
    });
    const fineBody = await streamBody(fine.url);
    await fine.close();

    const coarse = await startTestServer({
      cannedResponse: content,
      streamChunkSize: 100,
      streamChunkDelayMs: 0,
    });
    const coarseBody = await streamBody(coarse.url);
    await coarse.close();

    const fineCount = deltaCount(parseEvents(fineBody));
    const coarseCount = deltaCount(parseEvents(coarseBody));
    expect(fineCount).toBeGreaterThan(coarseCount);
    expect(coarseCount).toBeGreaterThanOrEqual(1);
  });

  it("streams a canned response loaded from a markdown file", async () => {
    const file = join(RESPONSES_DIR, "recipe.md");
    const server = await startTestServer({ cannedResponseFile: file });
    const body = await streamBody(server.url);
    await server.close();

    expect(deltaText(parseEvents(body))).toBe(readResponse("recipe.md"));
  });
});
