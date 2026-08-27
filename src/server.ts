import { appendFileSync } from "node:fs";

import { startAnthropicMock, startOpenAIMock } from "./create-mock";
import type { MockOptions } from "./types";

// Distinct defaults so both providers can run side by side.
const DEFAULT_ANTHROPIC_PORT = 8787;
const DEFAULT_OPENAI_PORT = 8788;
const DEFAULT_HOST = "127.0.0.1";

type Provider = "anthropic" | "openai";

// The provider is selected by CLI argument (`llm-mock openai`) or the
// LLM_MOCK_PROVIDER environment variable, defaulting to anthropic.
const resolveProvider = (arg: string | undefined): Provider => {
  const raw = (
    arg ??
    process.env.LLM_MOCK_PROVIDER ??
    "anthropic"
  ).toLowerCase();
  if (raw === "anthropic" || raw === "openai") return raw;
  console.error(
    `llm-mock: unknown provider "${raw}" (expected "anthropic" or "openai")`,
  );
  process.exit(2);
};

// LLM_MOCK_LOG appends one "METHOD url" line per request, so a test suite
// can assert which endpoints a client actually called.
const requestLogger = (
  logFile: string | undefined,
): MockOptions["onRequest"] =>
  logFile === undefined
    ? undefined
    : (request) =>
        appendFileSync(logFile, `${request.method} ${request.url}\n`);

const run = async (): Promise<void> => {
  const provider = resolveProvider(process.argv[2]);
  const defaultPort =
    provider === "openai" ? DEFAULT_OPENAI_PORT : DEFAULT_ANTHROPIC_PORT;
  const envPort = Number(process.env.PORT);
  const port =
    process.env.PORT && !Number.isNaN(envPort) ? envPort : defaultPort;
  const options: MockOptions = {
    port,
    host: process.env.HOST ?? DEFAULT_HOST,
    cannedResponse: process.env.LLM_MOCK_CANNED_RESPONSE,
    onRequest: requestLogger(process.env.LLM_MOCK_LOG),
  };
  const start = provider === "openai" ? startOpenAIMock : startAnthropicMock;
  const mock = await start(options);
  console.log(`llm-mock (${provider}) listening on ${mock.url}`);
};

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
