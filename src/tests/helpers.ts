import ky, { type KyInstance } from "ky";

import { startAnthropicMock, startOpenAIMock } from "../create-mock";
import type { MockOptions, RunningMock } from "../types";

// ky retries transient connection errors by default; disabling retries keeps
// failure-path assertions immediate and deterministic.
const createClient = (url: string): KyInstance =>
  ky.create({ prefix: url, retry: 0 });

type TestServer = {
  readonly url: string;
  readonly client: KyInstance;
  readonly close: () => Promise<void>;
};

const withClient = (mock: RunningMock): TestServer => ({
  url: mock.url,
  client: createClient(mock.url),
  close: mock.close,
});

const startTestServer = async (options?: MockOptions): Promise<TestServer> =>
  withClient(await startAnthropicMock(options));

const startOpenAITestServer = async (
  options?: MockOptions,
): Promise<TestServer> => withClient(await startOpenAIMock(options));

export type { TestServer };
export { createClient, startOpenAITestServer, startTestServer };
