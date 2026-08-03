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

// The structured `event: error` SSE frame (Channel B, PR #18) is the only
// mid-stream error channel the real API uses after a 200. Here it carries a
// `rate_limit_error` — a transient, retryable condition. Only the mock can
// emit this token, so finding it proves the streamed deltas reached goose.
const CANNED_REPLY = "sse-ratelimit-token-a1b2c3";

// Long enough that deltas genuinely stream before the error frame (so the
// client receives real content), short enough to keep the test fast.
const STREAM_ERROR_AFTER_MS = 1500;

// Defensive backstop: a fast non-retryable 400 caps the runtime if a future
// goose retried aggressively. The current goose never reaches it.
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

// Unlike the abrupt-socket case (goose-midstream-error), a Channel B error is
// delivered as a well-formed `event: error` frame after the 200. Today goose
// silently drops that frame, surfaces the partial deltas as a successful
// answer, and exits 0 — arguably worse than the socket drop, which at least
// surfaces a "stream decode error". The assertions below capture that
// behaviour and must be inverted once goose detects and surfaces/retries the
// mid-stream error.
describe.skipIf(!gooseInstalled)(
  "goose CLI mid-stream SSE rate-limit error (integration, Channel B / PR #18)",
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

    it(
      "silently succeeds with partial output instead of surfacing or retrying a mid-stream SSE rate-limit error",
      async () => {
        writeGooseProfile(scratch.configHome, "claude-sonnet-4-5");

        let messageRequests = 0;
        let mainRequests = 0;
        app = createAnthropicMock({
          cannedResponse: CANNED_REPLY,
          streamSseErrorAfterMs: STREAM_ERROR_AFTER_MS,
          streamSseErrorType: "rate_limit_error",
          streamSseErrorMessage: "rate_limit_error: too many requests",
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

        // CURRENT BEHAVIOUR (suboptimal): goose reports success. The
        // structured `event: error` frame emitted mid-stream is silently
        // dropped, so the process exits 0 as if the response completed. A
        // fixed goose would surface the error (non-zero exit or a message).
        expect(
          result.exitCode,
          asText(result.stderr) || asText(result.stdout),
        ).toBe(0);

        // goose surfaces the partial streamed deltas as though they were the
        // model's real answer, with no indication the stream was terminated
        // by a rate-limit error (unlike the abrupt-socket case, which prints
        // "stream decode error" / "please resend").
        expect(output).toContain(CANNED_REPLY.toLowerCase());
        expect(output).not.toMatch(/please resend/);
        expect(output).not.toMatch(/stream decode error/);
        expect(output).not.toMatch(/rate_limit_error/);
        expect(output).not.toMatch(/overloaded/);

        // The main response was attempted once and never retried, even
        // though a rate_limit_error is a transient, retryable condition. A
        // fixed goose would retry, making this greater than one.
        expect(mainRequests).toBe(1);
        expect(messageRequests).toBeLessThanOrEqual(MAX_STREAMING_REQUESTS);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
