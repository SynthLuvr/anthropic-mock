import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startAnthropicMock } from "../create-mock";
import type { RunningAnthropicMock } from "../types";

// `command -v` is POSIX, so this resolves on Linux and macOS. Probed once at
// import time so describe.skipIf gets a synchronous boolean without needing
// the full execa flow to fail.
const gooseInstalled = (() => {
  try {
    execSync("command -v goose", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// A canned reply that only the mock can produce, so finding it in goose's
// output proves the real goose binary routed through the mock instead of the
// live Anthropic API.
const CANNED_REPLY = "mock-reply-9f3a-goose-integration";

// Each scratch tree isolates every XDG base directory goose consults so the
// test never reads or mutates the user's real ~/.config/goose. Goose writes
// its sessions DB under XDG_DATA_HOME and logs under XDG_STATE_HOME.
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

// Writes a self-contained "profile": the built-in anthropic provider is the
// active provider with the requested model. ANTHROPIC_HOST (set at run time)
// is what actually redirects that provider's traffic to the mock, and the
// dummy ANTHROPIC_API_KEY satisfies goose's credential gate without ever
// touching the system keyring.
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

// execa types stdout/stderr as string | array | buffer to accommodate other
// encodings; with the default utf8 encoding they are always strings.
const asText = (value: unknown): string =>
  typeof value === "string" ? value : "";

// Mirrors GLV's approach of driving the real goose binary from a child
// process, but stays independent of GLV: goose is launched via execa with an
// isolated XDG profile wired to this project's mock, not GLV's mock script.
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

    expect(
      result.exitCode,
      asText(result.stderr) || asText(result.stdout),
    ).toBe(0);
    expect(result.stdout).toContain(CANNED_REPLY);
  });

  it("honours the model declared in the profile", async () => {
    writeGooseProfile(scratch.configHome, "claude-opus-4-5");
    const result = await runGoose(
      scratch,
      server.url,
      "Reply with the test token.",
    );

    expect(
      result.exitCode,
      asText(result.stderr) || asText(result.stdout),
    ).toBe(0);
    expect(result.stdout).toContain(CANNED_REPLY);
    expect(result.stdout).toContain("claude-opus-4-5");
  });
});
