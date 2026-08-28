import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chatCompletion } from "../../openai/schemas";
import { startOpenAITestServer, type TestServer } from "../helpers";

const RESPONSES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "responses",
);

const postCompletion = (server: TestServer, json: object): Promise<Response> =>
  fetch(`${server.url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(json),
  });

describe("POST /v1/chat/completions, non-streaming (integration)", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startOpenAITestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("responds with a chat.completion carrying the canned content", async () => {
    const response = await postCompletion(server, {
      model: "gpt-4o",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const parsed = chatCompletion.assert(await response.json());
    expect(parsed.object).toBe("chat.completion");
    expect(parsed.choices).toHaveLength(1);
    expect(parsed.choices[0]!.message.role).toBe("assistant");
    expect(parsed.choices[0]!.message.content).toContain(
      "canned response from llm-mockingbird",
    );
    expect(parsed.choices[0]!.finish_reason).toBe("stop");
  });

  it("echoes the requested model in the completion", async () => {
    const response = await postCompletion(server, {
      model: "gpt-4.1",
      messages: [{ role: "user", content: "ping" }],
    });
    const parsed = chatCompletion.assert(await response.json());
    expect(parsed.model).toBe("gpt-4.1");
  });

  it("falls back to the default model when none is provided", async () => {
    const response = await postCompletion(server, { messages: [] });
    const parsed = chatCompletion.assert(await response.json());
    expect(parsed.model).toBe("gpt-4o");
  });

  it("falls back to the default model when the model is an empty string", async () => {
    const response = await postCompletion(server, { model: "", messages: [] });
    const parsed = chatCompletion.assert(await response.json());
    expect(parsed.model).toBe("gpt-4o");
  });

  it("emits a custom canned response", async () => {
    const custom = await startOpenAITestServer({ cannedResponse: "pong" });
    const response = await postCompletion(custom, { messages: [] });
    const parsed = chatCompletion.assert(await response.json());
    expect(parsed.choices[0]!.message.content).toBe("pong");
    await custom.close();
  });

  it("streams a canned response loaded from a markdown file", async () => {
    const custom = await startOpenAITestServer({
      cannedResponseFile: join(RESPONSES_DIR, "greeting.md"),
    });
    const response = await postCompletion(custom, { messages: [] });
    const parsed = chatCompletion.assert(await response.json());
    expect(parsed.choices[0]!.message.content).toContain("# Greeting");
    await custom.close();
  });

  it("reports configured token usage", async () => {
    const custom = await startOpenAITestServer({
      inputTokens: 42,
      outputTokens: 7,
    });
    const response = await postCompletion(custom, { messages: [] });
    const parsed = chatCompletion.assert(await response.json());
    expect(parsed.usage).toEqual({
      prompt_tokens: 42,
      completion_tokens: 7,
      total_tokens: 49,
    });
    await custom.close();
  });

  it("fails with the error object as an HTTP 500 after the configured delay", async () => {
    const custom = await startOpenAITestServer({
      streamSseErrorAfterMs: 50,
      streamSseErrorType: "rate_limit_error",
      streamSseErrorMessage: "Too many requests",
    });
    const start = Date.now();
    const response = await postCompletion(custom, {
      messages: [],
      stream: false,
    });
    const elapsed = Date.now() - start;

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        message: "Too many requests",
        type: "rate_limit_error",
        param: null,
        code: null,
      },
    });
    // The failure is delayed, mirroring the streaming error modes.
    expect(elapsed).toBeGreaterThanOrEqual(40);
    await custom.close();
  });
});
