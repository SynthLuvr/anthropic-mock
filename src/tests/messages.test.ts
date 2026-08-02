import { describe, expect, it } from "vitest";

import { createAnthropicMock } from "../index";

describe("POST /v1/messages", () => {
  it("streams a canned SSE response in Anthropic event order", async () => {
    const app = createAnthropicMock();
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "claude-sonnet-4-5",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1024,
        stream: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");

    const body = response.body;
    const events = body.split("\n\n").filter((block) => block.length > 0);
    const types = events
      .map((block) => block.split("\n")[0])
      .filter((line) => line.startsWith("event: "))
      .map((line) => line.slice("event: ".length));

    expect(types).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(body).toContain('"type":"text_delta"');
    expect(body).toContain('"stop_reason":"end_turn"');
    expect(body).toContain("data: [DONE]");
    await app.close();
  });

  it("echoes the requested model in the message_start payload", async () => {
    const app = createAnthropicMock();
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: { model: "claude-opus-4-5", messages: [] },
    });
    expect(response.body).toContain('"model":"claude-opus-4-5"');
    await app.close();
  });

  it("falls back to the default model when none is provided", async () => {
    const app = createAnthropicMock();
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: { messages: [] },
    });
    expect(response.body).toContain('"model":"claude-sonnet-4-5"');
    await app.close();
  });

  it("uses a custom canned response", async () => {
    const app = createAnthropicMock({ cannedResponse: "pong" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: { messages: [] },
    });
    expect(response.body).toContain('"text":"pong"');
    await app.close();
  });

  it("reports token usage in message_start and message_delta", async () => {
    const app = createAnthropicMock({ inputTokens: 42, outputTokens: 7 });
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: { messages: [] },
    });
    expect(response.body).toContain('"input_tokens":42');
    expect(response.body).toContain('"output_tokens":7');
    await app.close();
  });
});
