import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAnthropicMock } from "../create-mock";
import {
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

// Long enough that the socket dies genuinely mid-stream (not an instant
// connection drop), short enough to keep the test fast.
const STREAM_ERROR_AFTER_MS = 1500;

describe.skipIf(!gooseInstalled)(
  "goose CLI mid-stream error retry (integration, issue #10525)",
  () => {
    let scratch: Scratch;
    let app: FastifyInstance;

    beforeEach(() => {
      scratch = createScratch();
    });

    afterEach(() => teardown(app, scratch));

    // Issue #10525: a transient mid-stream disconnect is flagged recoverable,
    // yet goose halts and tells the user to "Please resend" rather than
    // retrying. The assertions below capture that buggy behaviour and must be
    // inverted once the retry is fixed.
    it(
      "halts and asks the user to resend instead of retrying a mid-stream error",
      async () => {
        writeGooseProfile(scratch.configHome, "claude-sonnet-4-5");

        app = createAnthropicMock({
          streamErrorAfterMs: STREAM_ERROR_AFTER_MS,
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

        expect(output).toMatch(/please resend/);
        expect(output).toMatch(/stream decode error/);
        // The main response was attempted once and never retried; a fixed
        // goose would retry, making this greater than one.
        expect(counts.main()).toBe(1);
        expect(counts.messages()).toBeLessThanOrEqual(MAX_STREAMING_REQUESTS);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
