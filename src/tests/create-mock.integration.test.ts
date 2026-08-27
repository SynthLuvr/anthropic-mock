import { describe, expect, it } from "vitest";

import {
  createAnthropicMock,
  createOpenAIMock,
  startAnthropicMock,
  startOpenAIMock,
} from "../create-mock";
import { parsePort } from "../schemas";
import { createClient } from "./helpers";

describe("startAnthropicMock (integration)", () => {
  it("starts on an ephemeral port and reports a reachable url", async () => {
    const mock = await startAnthropicMock();

    expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await createClient(mock.url).get("v1/models");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("claude-sonnet-4-5");

    await mock.close();
  });

  it("honours the host option in the reported url", async () => {
    const mock = await startAnthropicMock({ host: "127.0.0.1" });
    expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await mock.close();
  });

  it("close() stops the server so subsequent requests fail", async () => {
    const mock = await startAnthropicMock();
    const client = createClient(mock.url);

    const ok = await client.get("v1/models");
    expect(ok.status).toBe(200);
    await ok.text();

    await mock.close();

    await expect(client.get("v1/models", { timeout: 2000 })).rejects.toThrow();
  });
});

describe("createAnthropicMock (integration)", () => {
  it("returns a Fastify app that serves the routes once listening", async () => {
    const app = createAnthropicMock();
    await app.listen({ port: 0, host: "127.0.0.1" });

    const port = parsePort(app.server.address());
    const url = `http://127.0.0.1:${port}`;

    const response = await createClient(url).get("v1/models");
    expect(response.status).toBe(200);
    await response.text();

    await app.close();
  });
});

describe("startOpenAIMock (integration)", () => {
  it("starts on an ephemeral port and reports a reachable url", async () => {
    const mock = await startOpenAIMock();

    expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await createClient(mock.url).get("v1/models");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("gpt-4o");

    await mock.close();
  });

  it("close() stops the server so subsequent requests fail", async () => {
    const mock = await startOpenAIMock();
    const client = createClient(mock.url);

    const ok = await client.get("v1/models");
    expect(ok.status).toBe(200);
    await ok.text();

    await mock.close();

    await expect(client.get("v1/models", { timeout: 2000 })).rejects.toThrow();
  });
});

describe("createOpenAIMock (integration)", () => {
  it("returns a Fastify app that serves the routes once listening", async () => {
    const app = createOpenAIMock();
    await app.listen({ port: 0, host: "127.0.0.1" });

    const port = parsePort(app.server.address());
    const url = `http://127.0.0.1:${port}`;

    const response = await createClient(url).post("v1/chat/completions", {
      json: { messages: [] },
    });
    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { object: string };
    expect(parsed.object).toBe("chat.completion");

    await app.close();
  });
});
