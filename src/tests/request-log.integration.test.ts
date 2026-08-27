import { type ChildProcessByStdio, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createOpenAIMock, startAnthropicMock } from "../create-mock";
import type { MockRequest } from "../types";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const CANNED = "logged canned reply";

type MockChild = ChildProcessByStdio<null, Readable, Readable>;

const postMessages = (url: string): Promise<Response> =>
  fetch(`${url}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", stream: true }),
  });

type DeltaEvent = { readonly delta?: { readonly text?: string } };

// Joins the streamed text_delta payloads so assertions hold regardless
// of how the canned text is split across frames.
const sseText = (body: string): string =>
  [...body.matchAll(/data: (\{.*\})\n/g)]
    .map((match) => JSON.parse(match[1]) as DeltaEvent)
    .map((event) => event.delta?.text ?? "")
    .join("");

// Resolves the mock's url from the child's "listening on" line; fails
// fast (with the child's output) if it exits before printing one.
const waitForUrl = async (child: MockChild): Promise<string> => {
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const match = output.match(/listening on (http:\/\/\S+)/);
    if (match) return match[1];
    if (child.exitCode !== null)
      throw new Error(`llm-mock exited early: ${output.trim()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`llm-mock did not start: ${output.trim()}`);
};

const stopChild = async (child: MockChild): Promise<void> => {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.on("close", () => resolve());
    setTimeout(resolve, 5_000);
  });
};

describe("onRequest option (integration)", () => {
  it("observes anthropic requests, including hijacked streaming replies", async () => {
    const seen: MockRequest[] = [];
    const mock = await startAnthropicMock({
      cannedResponse: CANNED,
      onRequest: (request) => seen.push(request),
    });
    try {
      await (await fetch(`${mock.url}/v1/models`)).text();
      const response = await postMessages(mock.url);
      expect(response.status).toBe(200);
      expect(sseText(await response.text())).toBe(CANNED);
      expect(seen).toEqual([
        { method: "GET", url: "/v1/models" },
        { method: "POST", url: "/v1/messages" },
      ]);
    } finally {
      await mock.close();
    }
  });

  it("observes openai requests", async () => {
    const seen: MockRequest[] = [];
    const app = createOpenAIMock({
      onRequest: (request) => seen.push(request),
    });
    try {
      const models = await app.inject({ method: "GET", url: "/v1/models" });
      expect(models.statusCode).toBe(200);
      const chat = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "gpt-4o", messages: [] },
      });
      expect(chat.statusCode).toBe(200);
      expect(seen).toEqual([
        { method: "GET", url: "/v1/models" },
        { method: "POST", url: "/v1/chat/completions" },
      ]);
    } finally {
      await app.close();
    }
  });
});

describe("standalone server env options (integration)", () => {
  it("logs requests to LLM_MOCK_LOG and serves LLM_MOCK_CANNED_RESPONSE", {
    timeout: 30_000,
  }, async () => {
    const root = mkdtempSync(join(tmpdir(), "llm-mock-log-"));
    const logFile = join(root, "requests.log");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/server.ts", "anthropic"],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PORT: "0",
          HOST: "127.0.0.1",
          LLM_MOCK_CANNED_RESPONSE: CANNED,
          LLM_MOCK_LOG: logFile,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    try {
      const url = await waitForUrl(child);
      await (await fetch(`${url}/v1/models`)).text();
      const response = await postMessages(url);
      expect(response.status).toBe(200);
      expect(sseText(await response.text())).toBe(CANNED);
      expect(readFileSync(logFile, "utf8")).toBe(
        "GET /v1/models\nPOST /v1/messages\n",
      );
    } finally {
      await stopChild(child);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
