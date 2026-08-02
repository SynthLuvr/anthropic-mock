import type { AddressInfo } from "node:net";
import ky from "ky";
import { describe, expect, it } from "vitest";

import { createAnthropicMock, startAnthropicMock } from "../index";

describe("startAnthropicMock (integration)", () => {
  it("starts on an ephemeral port and reports a reachable url", async () => {
    const mock = await startAnthropicMock();

    expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await ky.get(`${mock.url}/v1/models`, { retry: 0 });
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

    const ok = await ky.get(`${mock.url}/v1/models`, { retry: 0 });
    expect(ok.status).toBe(200);
    await ok.text();

    await mock.close();

    await expect(
      ky.get(`${mock.url}/v1/models`, { retry: 0, timeout: 2000 }),
    ).rejects.toThrow();
  });
});

describe("createAnthropicMock (integration)", () => {
  it("returns a Fastify app that serves the routes once listening", async () => {
    const app = createAnthropicMock();
    await app.listen({ port: 0, host: "127.0.0.1" });

    const port = (app.server.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;

    const response = await ky.get(`${url}/v1/models`, { retry: 0 });
    expect(response.status).toBe(200);
    await response.text();

    await app.close();
  });
});
