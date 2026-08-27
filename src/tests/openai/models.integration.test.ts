import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openAIModelsResponse } from "../../openai/schemas";
import { startOpenAITestServer, type TestServer } from "../helpers";

describe("GET /v1/models, OpenAI shape (integration)", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startOpenAITestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns the default model list", async () => {
    const parsed = openAIModelsResponse.assert(
      await server.client.get("v1/models").json(),
    );
    expect(parsed.data.map((m) => m.id)).toEqual([
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
    ]);
  });

  it("returns a custom model list", async () => {
    const custom = await startOpenAITestServer({
      models: ["custom-model-a", "custom-model-b"],
    });
    const parsed = openAIModelsResponse.assert(
      await custom.client.get("v1/models").json(),
    );
    expect(parsed.data.map((m) => m.id)).toEqual([
      "custom-model-a",
      "custom-model-b",
    ]);
    await custom.close();
  });

  it("shapes each entry like the OpenAI API", async () => {
    const parsed = openAIModelsResponse.assert(
      await server.client.get("v1/models").json(),
    );
    expect(parsed.object).toBe("list");
    expect(parsed.data[0]).toEqual({
      id: "gpt-4o",
      object: "model",
      created: 1735689600,
      owned_by: "system",
    });
  });

  it("responds with HTTP 200 and application/json", async () => {
    const response = await server.client.get("v1/models");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await response.json();
  });
});
