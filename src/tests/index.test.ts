import { describe, expect, it } from "vitest";

import { createAnthropicMock, startAnthropicMock } from "../index";

describe("createAnthropicMock", () => {
  it("returns an injectable Fastify app exposing the models route", async () => {
    const app = createAnthropicMock();
    const response = await app.inject({ method: "GET", url: "/v1/models" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});

describe("startAnthropicMock", () => {
  it("starts on an ephemeral port and reports a reachable url", async () => {
    const mock = await startAnthropicMock();
    expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await fetch(`${mock.url}/v1/models`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("claude-sonnet-4-5");

    await mock.close();
  });

  it("honours a custom model list via options", async () => {
    const mock = await startAnthropicMock({ models: ["claude-test-1"] });
    const response = await fetch(`${mock.url}/v1/models`);
    const text = await response.text();
    expect(text).toContain("claude-test-1");
    await mock.close();
  });
});
