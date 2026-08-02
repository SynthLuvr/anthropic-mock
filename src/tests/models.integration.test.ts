import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnthropicModel } from "../index";
import { startTestServer, type TestServer } from "./helpers";

describe("GET /v1/models (integration)", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns the default model list", async () => {
    const parsed = await server.client
      .get("v1/models")
      .json<{ data: AnthropicModel[] }>();
    expect(parsed.data.map((m) => m.id)).toEqual([
      "claude-sonnet-4-5",
      "claude-opus-4-5",
      "claude-haiku-4-5",
    ]);
  });

  it("returns a custom model list", async () => {
    const custom = await startTestServer({
      models: ["custom-model-a", "custom-model-b"],
    });
    const parsed = await custom.client
      .get("v1/models")
      .json<{ data: AnthropicModel[] }>();
    expect(parsed.data.map((m) => m.id)).toEqual([
      "custom-model-a",
      "custom-model-b",
    ]);
    await custom.close();
  });

  it("shapes each entry like the Anthropic API", async () => {
    const parsed = await server.client
      .get("v1/models")
      .json<{ data: AnthropicModel[] }>();
    expect(parsed.data[0]).toEqual({
      id: "claude-sonnet-4-5",
      type: "model",
      display_name: "claude-sonnet-4-5",
    });
  });

  it("responds with HTTP 200 and application/json", async () => {
    const response = await server.client.get("v1/models");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await response.json();
  });
});
