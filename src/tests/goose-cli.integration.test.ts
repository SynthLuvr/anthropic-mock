import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startAnthropicMock } from "../create-mock";
import type { RunningAnthropicMock } from "../types";
import {
  asText,
  createScratch,
  gooseInstalled,
  runGoose,
  type Scratch,
  writeGooseProfile,
} from "./goose-helpers";

// Only the mock can emit this token, so finding it in goose's output proves
// it reached the mock rather than the live Anthropic API.
const CANNED_REPLY = "mock-reply-9f3a-goose-integration";

const expectMockReply = (
  result: Awaited<ReturnType<typeof runGoose>>,
): void => {
  expect(result.exitCode, asText(result.stderr) || asText(result.stdout)).toBe(
    0,
  );
  expect(result.stdout).toContain(CANNED_REPLY);
};

describe.skipIf(!gooseInstalled)("goose CLI integration (real binary)", () => {
  let server: RunningAnthropicMock;
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = createScratch();
    server = await startAnthropicMock({ cannedResponse: CANNED_REPLY });
  });

  afterEach(async () => {
    await server.close();
    rmSync(scratch.root, { recursive: true, force: true });
  });

  it("routes the active Anthropic profile to the mock and emits its canned reply", async () => {
    writeGooseProfile(scratch.configHome, "claude-sonnet-4-5");
    const result = await runGoose(
      scratch,
      server.url,
      "Reply with the test token.",
    );

    expectMockReply(result);
  });

  it("honours the model declared in the profile", async () => {
    writeGooseProfile(scratch.configHome, "claude-opus-4-5");
    const result = await runGoose(
      scratch,
      server.url,
      "Reply with the test token.",
    );

    expectMockReply(result);
    expect(result.stdout).toContain("claude-opus-4-5");
  });
});
