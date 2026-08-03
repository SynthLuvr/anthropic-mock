import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAnthropicMock } from "../create-mock";
import {
  asText,
  createScratch,
  gooseInstalled,
  runGoose,
  type Scratch,
  writeGooseProfile,
} from "./goose-helpers";

// Hundreds of deltas flow before the socket is torn down, so the failure is
// unambiguously mid-stream (not an instant connection drop) while keeping the
// test fast.
const STREAM_ERROR_AFTER_MS = 1500;

// Backstop only: if a future goose retries aggressively, a fast non-retryable
// 400 caps the runtime. The current goose never reaches it.
const MAX_STREAMING_REQUESTS = 12;

const GOOSE_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 120_000;

// goose fires the main response and a background title-generation request
// concurrently; title requests carry "title" in their system prompt.
const isMainRequest = (system: unknown): boolean => {
  const text =
    typeof system === "string" ? system : JSON.stringify(system ?? "");
  return !text.includes("title");
};

describe.skipIf(!gooseInstalled)(
  "goose CLI mid-stream error retry (integration, issue #10525)",
  () => {
    let scratch: Scratch;
    let app: FastifyInstance;

    beforeEach(() => {
      scratch = createScratch();
    });

    afterEach(async () => {
      await app?.close();
      rmSync(scratch.root, { recursive: true, force: true });
    });

    // Issue #10525 reports that a transient mid-stream disconnect is labelled
    // recoverable yet goose never retries it: it halts and tells the user to
    // "Please resend your message to try again." This test reproduces that.
    // The assertions below document the buggy behaviour; once #10525 is fixed
    // goose will retry the main request and recover, so they must be inverted.
    it(
      "halts and asks the user to resend instead of retrying a mid-stream error",
      async () => {
        writeGooseProfile(scratch.configHome, "claude-sonnet-4-5");

        let messageRequests = 0;
        let mainRequests = 0;
        app = createAnthropicMock({
          streamErrorAfterMs: STREAM_ERROR_AFTER_MS,
        });
        app.addHook("preHandler", async (request, reply) => {
          if (request.method !== "POST" || request.url !== "/v1/messages")
            return;
          messageRequests++;
          const body = (request.body ?? {}) as { system?: unknown };
          if (isMainRequest(body.system)) mainRequests++;
          if (messageRequests > MAX_STREAMING_REQUESTS)
            return reply.code(400).send({
              type: "error",
              error: {
                type: "invalid_request_error",
                message: "anthropic-mock loop breaker",
              },
            });
        });

        await app.listen({ port: 0, host: "127.0.0.1" });
        const { port } = app.server.address() as AddressInfo;
        const url = `http://127.0.0.1:${port}`;

        const result = await runGoose(
          scratch,
          url,
          "Reply with the test token.",
          GOOSE_TIMEOUT_MS,
        );
        const output = `${asText(result.stdout)}\n${asText(
          result.stderr,
        )}`.toLowerCase();

        // The exact symptom from issue #10525.
        expect(output).toMatch(/please resend/);
        expect(output).toMatch(/stream decode error/);
        // The main response was attempted exactly once and never retried; a
        // fixed goose would retry, making this greater than one.
        expect(mainRequests).toBe(1);
        expect(messageRequests).toBeGreaterThan(0);
        expect(messageRequests).toBeLessThanOrEqual(MAX_STREAMING_REQUESTS);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
