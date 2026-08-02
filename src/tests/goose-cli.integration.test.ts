import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startAnthropicMock } from "../create-mock";
import type { RunningAnthropicMock } from "../types";

// Synchronous so describe.skipIf can branch at import time.
const gooseInstalled = (() => {
  try {
    execSync("command -v goose", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// Only the mock can emit this token, so finding it in goose's output proves
// it reached the mock rather than the live Anthropic API.
const CANNED_REPLY = "mock-reply-9f3a-goose-integration";

// Isolates every XDG directory goose consults so the test never reads or
// mutates the user's real ~/.config/goose.
type Scratch = {
  readonly root: string;
  readonly configHome: string;
  readonly dataHome: string;
  readonly stateHome: string;
};

const createScratch = (): Scratch => {
  const root = mkdtempSync(join(tmpdir(), "goose-cli-int-"));
  const configHome = join(root, "config");
  const dataHome = join(root, "data");
  const stateHome = join(root, "state");
  mkdirSync(join(configHome, "goose"), { recursive: true });
  return { root, configHome, dataHome, stateHome };
};

// The dummy ANTHROPIC_API_KEY satisfies goose's credential gate without
// touching the system keyring; ANTHROPIC_HOST (set at run time) is what
// actually points the provider at the mock.
const writeGooseProfile = (configHome: string, model: string): void => {
  const lines = [
    "active_provider: anthropic",
    "providers:",
    "  anthropic:",
    "    enabled: true",
    `    model: ${model}`,
    "    configured: true",
    "",
  ];
  writeFileSync(join(configHome, "goose", "config.yaml"), lines.join("\n"));
};

const runGoose = (
  scratch: Scratch,
  mockUrl: string,
  prompt: string,
): ReturnType<typeof execa> =>
  execa("goose", ["run", "-t", prompt, "--no-session"], {
    cwd: scratch.root,
    reject: false,
    timeout: 60000,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: scratch.configHome,
      XDG_DATA_HOME: scratch.dataHome,
      XDG_STATE_HOME: scratch.stateHome,
      ANTHROPIC_HOST: mockUrl,
      ANTHROPIC_API_KEY: "test-key",
      GOOSE_TELEMETRY_ENABLED: "false",
    },
  });

// execa widens stdout/stderr to a union for non-default encodings; under the
// default utf8 encoding they are always strings.
const asText = (value: unknown): string =>
  typeof value === "string" ? value : "";

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
