import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAnthropicMock } from "../create-mock";
import {
  asText,
  createScratch,
  GOOSE_TIMEOUT_MS,
  gooseInstalled,
  gooseOutput,
  MAX_STREAMING_REQUESTS,
  runGoose,
  type Scratch,
  startMock,
  TEST_TIMEOUT_MS,
  teardown,
  trackMessagesRequests,
  writeGooseProfile,
} from "./goose-helpers";

// A Channel B `event: error` frame (PR #18) is the only mid-stream error the
// real API sends after a 200; here it carries a retryable rate_limit_error.
// Only the mock can emit this token, so finding it proves goose saw the
// streamed deltas before the error frame.
const CANNED_REPLY = "sse-ratelimit-token-a1b2c3";

// Long enough that deltas stream before the error; short enough to be fast.
const STREAM_ERROR_AFTER_MS = 1500;

// goose silently drops a Channel B error frame, surfaces the partial deltas as
// a successful answer, and exits 0 — arguably worse than the abrupt-socket
// case, which at least prints "stream decode error". These assertions capture
// that behaviour and must be inverted once goose detects/retries the error.
describe.skipIf(!gooseInstalled)(
  "goose CLI mid-stream SSE rate-limit error (integration, Channel B / PR #18)",
  () => {
    let scratch: Scratch;
    let app: FastifyInstance;

    beforeEach(() => {
      scratch = createScratch();
    });

    afterEach(() => teardown(app, scratch));

    it(
      "silently succeeds with partial output instead of surfacing or retrying a mid-stream SSE rate-limit error",
      async () => {
        writeGooseProfile(scratch.configHome, "claude-sonnet-4-5");

        app = createAnthropicMock({
          cannedResponse: CANNED_REPLY,
          streamSseErrorAfterMs: STREAM_ERROR_AFTER_MS,
          streamSseErrorType: "rate_limit_error",
          streamSseErrorMessage: "rate_limit_error: too many requests",
        });
        const counts = trackMessagesRequests(app);

        const url = await startMock(app);

        const result = await runGoose(
          scratch,
          url,
          "Reply with the test token.",
          GOOSE_TIMEOUT_MS,
        );
        const output = gooseOutput(result);

        // CURRENT BEHAVIOUR (suboptimal): the error frame is dropped silently,
        // so goose exits 0 as if the response completed. A fixed goose would
        // surface a non-zero exit or an error message.
        expect(
          result.exitCode,
          asText(result.stderr) || asText(result.stdout),
        ).toBe(0);

        // The partial deltas are shown as the model's answer, with no sign
        // the stream was terminated by a rate-limit error.
        expect(output).toContain(CANNED_REPLY.toLowerCase());
        expect(output).not.toMatch(/please resend/);
        expect(output).not.toMatch(/stream decode error/);
        expect(output).not.toMatch(/rate_limit_error/);
        expect(output).not.toMatch(/overloaded/);

        // The main request ran once and was never retried, though
        // rate_limit_error is retryable. A fixed goose would retry (> 1).
        expect(counts.main()).toBe(1);
        expect(counts.messages()).toBeLessThanOrEqual(MAX_STREAMING_REQUESTS);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
