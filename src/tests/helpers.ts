import ky, { type KyInstance } from "ky";

import { startAnthropicMock } from "../create-mock";
import type { AnthropicMockOptions } from "../types";

// ky retries transient connection errors by default; disabling retries keeps
// failure-path assertions immediate and deterministic.
const createClient = (url: string): KyInstance =>
  ky.create({ prefix: url, retry: 0 });

type TestServer = {
  readonly url: string;
  readonly client: KyInstance;
  readonly close: () => Promise<void>;
};

const startTestServer = async (
  options?: AnthropicMockOptions,
): Promise<TestServer> => {
  const { url, close } = await startAnthropicMock(options);
  return { url, client: createClient(url), close };
};

export type { TestServer };
export { createClient, startTestServer };
