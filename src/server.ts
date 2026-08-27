import { startAnthropicMock, startOpenAIMock } from "./create-mock";

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

const run = async (): Promise<void> => {
  const provider = resolveProvider(process.argv[2]);
  const defaultPort =
    provider === "openai" ? DEFAULT_OPENAI_PORT : DEFAULT_ANTHROPIC_PORT;
  const envPort = Number(process.env.PORT);
  const port =
    process.env.PORT && !Number.isNaN(envPort) ? envPort : defaultPort;
  const host = process.env.HOST ?? DEFAULT_HOST;
  const start = provider === "openai" ? startOpenAIMock : startAnthropicMock;
  const mock = await start({ port, host });
  console.log(`llm-mock (${provider}) listening on ${mock.url}`);
};

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
