import { startAnthropicMock } from "./create-mock";

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";

const run = async (): Promise<void> => {
  const envPort = Number(process.env.PORT);
  const port =
    process.env.PORT && !Number.isNaN(envPort) ? envPort : DEFAULT_PORT;
  const host = process.env.HOST ?? DEFAULT_HOST;
  const mock = await startAnthropicMock({ port, host });
  console.log(`anthropic-mock listening on ${mock.url}`);
};

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
