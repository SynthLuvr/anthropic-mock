import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { startOpenAITestServer } from "../helpers";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const RESPONSES_DIR = join(TESTS_DIR, "..", "..", "responses");

const readResponse = (name: string): string =>
  readFileSync(join(RESPONSES_DIR, name), "utf8");

const postStreaming = (url: string): Promise<Response> =>
  fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: "ping" }],
      stream: true,
    }),
  });

// OpenAI SSE frames are data-only (no `event:` lines), so the parseable
// unit is each block's `data:` payload.
const parseDataFrames = (body: string): readonly string[] =>
  body
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line) => line !== undefined)
    .map((line) => line.slice("data: ".length));

const parseChunks = (frames: readonly string[]): readonly object[] =>
  frames
    .filter((frame) => frame !== "[DONE]")
    .map((frame) => JSON.parse(frame) as object);

const deltaContent = (chunks: readonly object[]): readonly string[] =>
  chunks
    .map(
      (chunk) =>
        (chunk as { choices?: readonly { delta?: { content?: unknown } }[] })
          .choices?.[0]?.delta?.content,
    )
    .filter((content): content is string => typeof content === "string");

const deltaText = (chunks: readonly object[]): string =>
  deltaContent(chunks).join("");

const contentChunkCount = (chunks: readonly object[]): number =>
  deltaContent(chunks).filter((text) => text.length > 0).length;

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
    try {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text.length > 0) reads.push({ elapsed: Date.now() - start, text });
    } catch {
      break;
    }
  }
  return { reads, body: reads.map((read) => read.text).join("") };
};

const streamBody = async (url: string): Promise<string> => {
  const response = await postStreaming(url);
  const { body } = await drain(response);
  return body;
};

describe("POST /v1/chat/completions incremental streaming (integration)", () => {
  it("streams data-only frames terminated by [DONE]", async () => {
    const server = await startOpenAITestServer();
    const response = await postStreaming(server.url);
    const { body } = await drain(response);
    await server.close();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    // The OpenAI wire format carries no event names, only data lines.
    expect(body).not.toContain("event: ");
    const frames = parseDataFrames(body);
    expect(frames[frames.length - 1]).toBe("[DONE]");
  });

  it("emits the OpenAI chunk sequence: role, content deltas, stop", async () => {
    const server = await startOpenAITestServer();
    const body = await streamBody(server.url);
    await server.close();

    const chunks = parseChunks(parseDataFrames(body));
    expect(chunks.length).toBeGreaterThan(2);
    const first = chunks[0] as {
      object: string;
      choices: readonly {
        delta: { role?: string };
        finish_reason: string | null;
      }[];
    };
    expect(first.object).toBe("chat.completion.chunk");
    expect(first.choices[0]!.delta.role).toBe("assistant");
    expect(first.choices[0]!.finish_reason).toBeNull();

    const last = chunks[chunks.length - 1] as {
      choices: readonly { delta: object; finish_reason: string | null }[];
    };
    expect(last.choices[0]!.delta).toEqual({});
    expect(last.choices[0]!.finish_reason).toBe("stop");

    // Every chunk shares the same fixed envelope fields.
    for (const chunk of chunks)
      expect((chunk as { id: string }).id).toBe("chatcmpl-mock-0001");
  });

  it("reassembles chunked content deltas back into the source markdown", async () => {
    const content = readResponse("essay.md");
    const server = await startOpenAITestServer({
      cannedResponse: content,
      streamChunkSize: 12,
    });
    const body = await streamBody(server.url);
    await server.close();

    const chunks = parseChunks(parseDataFrames(body));
    expect(contentChunkCount(chunks)).toBeGreaterThan(1);
    expect(deltaText(chunks)).toBe(content);
  });

  it("delivers the stream over time rather than as a single burst", async () => {
    const server = await startOpenAITestServer({
      cannedResponse: readResponse("recipe.md"),
      streamChunkSize: 8,
      streamChunkDelayMs: 6,
    });
    const response = await postStreaming(server.url);
    const { reads, body } = await drain(response);
    await server.close();

    expect(reads.length).toBeGreaterThan(1);
    // The terminal [DONE] and stop chunk are written last. If the whole
    // body had been buffered and sent at once, the first read would already
    // contain them — so their absence proves the stream is incremental.
    expect(reads[0]!.text).not.toContain("[DONE]");
    expect(reads[0]!.text).not.toContain('"finish_reason":"stop"');
    expect(body).toContain("[DONE]");
    // Frames are spread across time, not delivered in a single tick.
    const first = reads[0]!.elapsed;
    const last = reads[reads.length - 1]!.elapsed;
    expect(last - first).toBeGreaterThanOrEqual(5);
  });

  it("emits more content deltas as the chunk size shrinks", async () => {
    const content = readResponse("greeting.md");

    const fine = await startOpenAITestServer({
      cannedResponse: content,
      streamChunkSize: 4,
      streamChunkDelayMs: 0,
    });
    const fineBody = await streamBody(fine.url);
    await fine.close();

    const coarse = await startOpenAITestServer({
      cannedResponse: content,
      streamChunkSize: 100,
      streamChunkDelayMs: 0,
    });
    const coarseBody = await streamBody(coarse.url);
    await coarse.close();

    const fineCount = contentChunkCount(parseChunks(parseDataFrames(fineBody)));
    const coarseCount = contentChunkCount(
      parseChunks(parseDataFrames(coarseBody)),
    );
    expect(fineCount).toBeGreaterThan(coarseCount);
    expect(coarseCount).toBeGreaterThanOrEqual(1);
  });

  it("streams a canned response loaded from a markdown file", async () => {
    const file = join(RESPONSES_DIR, "recipe.md");
    const server = await startOpenAITestServer({ cannedResponseFile: file });
    const body = await streamBody(server.url);
    await server.close();

    expect(deltaText(parseChunks(parseDataFrames(body)))).toBe(
      readResponse("recipe.md"),
    );
  });
});

describe("POST /v1/chat/completions mid-stream error (integration)", () => {
  it("streams opening chunks and deltas, then aborts without closing frames", async () => {
    const content = "the quick brown fox jumps over";
    const server = await startOpenAITestServer({
      cannedResponse: content,
      streamChunkSize: 8,
      streamChunkDelayMs: 2,
      streamErrorAfterMs: 60,
    });

    const response = await postStreaming(server.url);
    const { body } = await drain(response);
    await server.close();

    expect(response.status).toBe(200);
    const chunks = parseChunks(parseDataFrames(body));
    // The opening chunk and several content deltas were delivered first.
    expect(
      (chunks[0] as { choices: readonly { delta: { role?: string } }[] })
        .choices[0]!.delta.role,
    ).toBe("assistant");
    expect(contentChunkCount(chunks)).toBeGreaterThan(1);
    // Real content flowed before the error.
    expect(deltaText(chunks).startsWith(content)).toBe(true);
    // The stream was cut off mid-flight: no stop chunk, no [DONE] sentinel,
    // so the response is truncated and unparsable.
    expect(body).not.toContain('"finish_reason":"stop"');
    expect(body).not.toContain("[DONE]");
  });

  it("streams for at least the configured duration before aborting", async () => {
    const server = await startOpenAITestServer({
      cannedResponse: "x".repeat(256),
      streamChunkSize: 4,
      streamChunkDelayMs: 2,
      streamErrorAfterMs: 150,
    });

    const start = Date.now();
    const response = await postStreaming(server.url);
    await drain(response);
    const elapsed = Date.now() - start;
    await server.close();

    expect(response.status).toBe(200);
    // The deltas genuinely streamed over a period of time before the error,
    // rather than being a single burst that failed instantly.
    expect(elapsed).toBeGreaterThanOrEqual(120);
  });
});

describe("POST /v1/chat/completions mid-stream SSE error (integration)", () => {
  it("emits a parseable error frame after streaming opening chunks and deltas", async () => {
    const content = "the quick brown fox jumps over";
    const server = await startOpenAITestServer({
      cannedResponse: content,
      streamChunkSize: 8,
      streamChunkDelayMs: 2,
      streamSseErrorAfterMs: 60,
    });

    const response = await postStreaming(server.url);
    const { body } = await drain(response);
    await server.close();

    expect(response.status).toBe(200);
    const frames = parseDataFrames(body);
    const chunks = parseChunks(frames);
    // Opening chunk and deltas were delivered before the error.
    expect(
      (chunks[0] as { choices: readonly { delta: { role?: string } }[] })
        .choices[0]!.delta.role,
    ).toBe("assistant");
    expect(contentChunkCount(chunks)).toBeGreaterThan(1);
    expect(deltaText(chunks).startsWith(content)).toBe(true);
    // Exactly one error frame, and it is the last frame on the wire.
    const errorFrames = chunks.filter(
      (chunk) => "error" in (chunk as Record<string, unknown>),
    );
    expect(errorFrames).toHaveLength(1);
    expect(frames[frames.length - 1]).not.toBe("[DONE]");
    // The error frame is structured and parseable, matching the OpenAI
    // error shape.
    expect(errorFrames[0]).toEqual({
      error: {
        message:
          "The server had an error while processing your request. Sorry about that!",
        type: "server_error",
        param: null,
        code: null,
      },
    });
    // The error terminates the stream: no stop chunk, no [DONE].
    expect(body).not.toContain('"finish_reason":"stop"');
    expect(body).not.toContain("[DONE]");
  });

  it("honours a custom error type and message", async () => {
    const server = await startOpenAITestServer({
      cannedResponse: "x".repeat(64),
      streamChunkSize: 8,
      streamChunkDelayMs: 1,
      streamSseErrorAfterMs: 30,
      streamSseErrorType: "rate_limit_error",
      streamSseErrorMessage: "Too many tokens",
    });

    const response = await postStreaming(server.url);
    const { body } = await drain(response);
    await server.close();

    const errorFrames = parseChunks(parseDataFrames(body)).filter(
      (chunk) => "error" in (chunk as Record<string, unknown>),
    );
    expect(errorFrames).toHaveLength(1);
    expect(errorFrames[0]).toEqual({
      error: {
        message: "Too many tokens",
        type: "rate_limit_error",
        param: null,
        code: null,
      },
    });
  });
});
