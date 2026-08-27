import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startOpenAIMock } from "../create-mock";
import type { RunningOpenAIMock } from "../types";
import {
  asText,
  createScratch,
  gooseInstalled,
  runGooseOpenAI,
  type Scratch,
  writeGooseOpenAIProfile,
} from "./goose-helpers";

// Only the mock can emit this token, so finding it in goose's output proves
// it reached the mock rather than the live OpenAI API.
const CANNED_REPLY = "openai-mock-reply-77e2-goose-integration";

describe.skipIf(!gooseInstalled)(
  "goose CLI integration, OpenAI provider (real binary)",
  () => {
    let server: RunningOpenAIMock;
    let scratch: Scratch;

    beforeEach(async () => {
      scratch = createScratch();
      server = await startOpenAIMock({ cannedResponse: CANNED_REPLY });
    });

    afterEach(async () => {
      await server.close();
      rmSync(scratch.root, { recursive: true, force: true });
    });

    it("routes the active OpenAI profile to the mock and emits its canned reply", async () => {
      writeGooseOpenAIProfile(scratch.configHome, "gpt-4o");
      const result = await runGooseOpenAI(
        scratch,
        server.url,
        "Reply with the test token.",
      );

      expect(
        result.exitCode,
        asText(result.stderr) || asText(result.stdout),
      ).toBe(0);
      expect(result.stdout).toContain(CANNED_REPLY);
    });

    it("honours the model declared in the profile", async () => {
      writeGooseOpenAIProfile(scratch.configHome, "gpt-4o-mini");
      const result = await runGooseOpenAI(
        scratch,
        server.url,
        "Reply with the test token.",
      );

      expect(
        result.exitCode,
        asText(result.stderr) || asText(result.stdout),
      ).toBe(0);
      expect(result.stdout).toContain(CANNED_REPLY);
    });
  },
);
