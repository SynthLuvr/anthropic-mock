import ky, { type KyInstance } from "ky";

import { type AnthropicMockOptions, startAnthropicMock } from "../index";

// ky retries transient connection errors by default; disabling retries keeps
// failure-path assertions immediate and deterministic.
const createClient = (url: string): KyInstance =>
  ky.create({ prefix: url, retry: 0 });

type TestServer = {
  readonly client: KyInstance;
  readonly close: () => Promise<void>;
};

const startTestServer = async (
  options?: AnthropicMockOptions,
): Promise<TestServer> => {
  const { url, close } = await startAnthropicMock(options);
  return { client: createClient(url), close };
};

export type { TestServer };
export { createClient, startTestServer };
