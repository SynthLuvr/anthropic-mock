import { describe, expect, it } from "vitest";

import {
  createAnthropicMock,
  createOpenAIMock,
  startAnthropicMock,
  startOpenAIMock,
} from "../create-mock";
import { parsePort } from "../schemas";
import type { RunningMock } from "../types";
import { createClient } from "./helpers";

// Starts a mock, checks its reported url shape and reachable model list,
// and shuts it down again.
const expectEphemeralServer = async (
  start: () => Promise<RunningMock>,
  model: string,
): Promise<void> => {
  const mock = await start();

  expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

  const response = await createClient(mock.url).get("v1/models");
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain(model);

  await mock.close();
};

// Starts a mock, verifies it answers, then proves close() takes it down.
const expectCloseStopsServer = async (
  start: () => Promise<RunningMock>,
): Promise<void> => {
  const mock = await start();
  const client = createClient(mock.url);

  const ok = await client.get("v1/models");
  expect(ok.status).toBe(200);
  await ok.text();

  await mock.close();

  await expect(client.get("v1/models", { timeout: 2000 })).rejects.toThrow();
};

describe("startAnthropicMock (integration)", () => {
  it("starts on an ephemeral port and reports a reachable url", () =>
    expectEphemeralServer(startAnthropicMock, "claude-sonnet-4-5"));

  it("honours the host option in the reported url", async () => {
    const mock = await startAnthropicMock({ host: "127.0.0.1" });
    expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await mock.close();
  });

  it("close() stops the server so subsequent requests fail", () =>
    expectCloseStopsServer(startAnthropicMock));
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
  it("starts on an ephemeral port and reports a reachable url", () =>
    expectEphemeralServer(startOpenAIMock, "gpt-4o"));

  it("close() stops the server so subsequent requests fail", () =>
    expectCloseStopsServer(startOpenAIMock));
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
