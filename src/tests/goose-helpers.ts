import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";

// Synchronous so describe.skipIf can branch at import time.
const gooseInstalled = (() => {
  try {
    execSync("command -v goose", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

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
  timeoutMs = 60000,
): ReturnType<typeof execa> =>
  execa("goose", ["run", "-t", prompt, "--no-session"], {
    cwd: scratch.root,
    reject: false,
    timeout: timeoutMs,
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

export type { Scratch };
export { asText, createScratch, gooseInstalled, runGoose, writeGooseProfile };
