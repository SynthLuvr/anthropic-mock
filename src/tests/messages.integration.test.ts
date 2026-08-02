import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startTestServer, type TestServer } from "./helpers";

const sseEventTypes = (body: string): readonly string[] =>
  body
    .split("\n\n")
    .map((block) => block.split("\n")[0])
    .filter((line) => line.startsWith("event: "))
    .map((line) => line.slice("event: ".length));

const collapseRuns = <T>(values: readonly T[]): readonly T[] =>
  values.filter((value, index) => index === 0 || value !== values[index - 1]);

describe("POST /v1/messages (integration)", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("streams a canned SSE response in Anthropic event order", async () => {
    const body = await server.client
      .post("v1/messages", {
        json: {
          model: "claude-sonnet-4-5",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1024,
          stream: true,
        },
      })
      .text();

    expect(collapseRuns(sseEventTypes(body))).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    // The default greeting spans several text deltas once streamed in chunks.
    const deltaCount = sseEventTypes(body).filter(
      (type) => type === "content_block_delta",
    ).length;
    expect(deltaCount).toBeGreaterThan(1);
    expect(body).toContain('"type":"text_delta"');
    expect(body).toContain('"stop_reason":"end_turn"');
    expect(body).toContain("data: [DONE]");
  });

  it("responds with the text/event-stream content type", async () => {
    const response = await server.client.post("v1/messages", {
      json: { messages: [] },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    await response.text();
  });

  it("echoes the requested model in the message_start payload", async () => {
    const body = await server.client
      .post("v1/messages", {
        json: { model: "claude-opus-4-5", messages: [] },
      })
      .text();
    expect(body).toContain('"model":"claude-opus-4-5"');
  });

  it("falls back to the default model when none is provided", async () => {
    const body = await server.client
      .post("v1/messages", { json: { messages: [] } })
      .text();
    expect(body).toContain('"model":"claude-sonnet-4-5"');
  });

  it("falls back to the default model when the model is an empty string", async () => {
    const body = await server.client
      .post("v1/messages", { json: { model: "", messages: [] } })
      .text();
    expect(body).toContain('"model":"claude-sonnet-4-5"');
  });

  it("emits a custom canned response", async () => {
    const custom = await startTestServer({ cannedResponse: "pong" });
    const body = await custom.client
      .post("v1/messages", { json: { messages: [] } })
      .text();
    expect(body).toContain('"text":"pong"');
    await custom.close();
  });

  it("reports configured token usage", async () => {
    const custom = await startTestServer({ inputTokens: 42, outputTokens: 7 });
    const body = await custom.client
      .post("v1/messages", { json: { messages: [] } })
      .text();
    expect(body).toContain('"input_tokens":42');
    expect(body).toContain('"output_tokens":7');
    await custom.close();
  });
});
