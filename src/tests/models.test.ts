import { describe, expect, it } from "vitest";

import { createAnthropicMock } from "../index";

describe("GET /v1/models", () => {
  it("returns the default model list", async () => {
    const app = createAnthropicMock();
    const response = await app.inject({ method: "GET", url: "/v1/models" });
    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.body) as { data: { id: string }[] };
    const ids = parsed.data.map((m) => m.id);
    expect(ids).toEqual([
      "claude-sonnet-4-5",
      "claude-opus-4-5",
      "claude-haiku-4-5",
    ]);
    await app.close();
  });

  it("returns a custom model list", async () => {
    const app = createAnthropicMock({
      models: ["custom-model-a", "custom-model-b"],
    });
    const response = await app.inject({ method: "GET", url: "/v1/models" });
    const parsed = JSON.parse(response.body) as { data: { id: string }[] };
    expect(parsed.data.map((m) => m.id)).toEqual([
      "custom-model-a",
      "custom-model-b",
    ]);
    await app.close();
  });

  it("shapes each entry like the Anthropic API (only id is required)", async () => {
    const app = createAnthropicMock();
    const response = await app.inject({ method: "GET", url: "/v1/models" });
    const parsed = JSON.parse(response.body) as {
      data: { id: string; type: string }[];
    };
    expect(parsed.data[0]).toHaveProperty("id");
    expect(parsed.data[0].type).toBe("model");
    await app.close();
  });
});
