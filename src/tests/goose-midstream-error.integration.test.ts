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

// The mock streams deltas for this long, then tears the socket down mid-flight
// (no closing frames) — a mid-stream 500-class error. A deliberately long
// window proves goose endures a genuine stream before the failure, not an
// instant connection drop.
const STREAM_ERROR_AFTER_MS = 15_000;

// goose fires concurrent /v1/messages requests; this caps the streaming ones
// so the test observes the retry behaviour without looping forever. Once
// exceeded, the mock answers with a fast non-streaming 400 (a non-retryable
// client error) instead of another 15 s stream.
const MAX_STREAMING_REQUESTS = 4;

// Backstop: if goose retries indefinitely even on the fast 400s, the process
// timeout kills it so the test can never hang.
const GOOSE_TIMEOUT_MS = 120_000;

// Vitest test timeout: enough for a few 15 s retry waves plus goose start-up.
const TEST_TIMEOUT_MS = 180_000;

// Only the mock can emit this token; its absence from a clean run proves the
// stream never completed.
const CANNED_REPLY = "mock-reply-midstream-fidelity";

describe.skipIf(!gooseInstalled)(
  "goose CLI mid-stream error (integration)",
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
      "retries a 15 s mid-stream error, then surfaces the failure",
      async () => {
        writeGooseProfile(scratch.configHome, "claude-sonnet-4-5");

        // Count every POST /v1/messages so retries are detectable + bounded.
        let messageRequests = 0;
        app = createAnthropicMock({
          cannedResponse: CANNED_REPLY,
          streamErrorAfterMs: STREAM_ERROR_AFTER_MS,
        });

        app.addHook("preHandler", async (request, reply) => {
          if (request.method !== "POST" || request.url !== "/v1/messages")
            return;
          messageRequests++;
          if (messageRequests > MAX_STREAMING_REQUESTS)
            // Loop breaker: a 400 is a non-retryable client error, so the
            // SDK stops immediately instead of looping through more streams.
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

        const output = `${asText(result.stdout)}\n${asText(result.stderr)}`;

        // goose reached the mock and tripped the mid-stream error.
        expect(messageRequests).toBeGreaterThanOrEqual(1);

        // goose retried the failed stream rather than giving up on the first
        // error — the behaviour this test exists to verify.
        expect(messageRequests).toBeGreaterThan(1);

        // The loop breaker kept retries bounded: no infinite loop.
        expect(messageRequests).toBeLessThanOrEqual(
          MAX_STREAMING_REQUESTS + 50,
        );

        // goose surfaces the failure in its output. It exits 0 for a
        // mid-stream error, so the assertion keys off the message text rather
        // than the exit code.
        expect(output.toLowerCase()).toMatch(
          /error|fail|unable|retry|resend|abort/,
        );
      },
      TEST_TIMEOUT_MS,
    );
  },
);
