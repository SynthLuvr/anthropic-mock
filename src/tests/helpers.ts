import ky, { type KyInstance } from "ky";

import { type AnthropicMockOptions, startAnthropicMock } from "../index";

type TestServer = {
  readonly url: string;
  readonly client: KyInstance;
  readonly close: () => Promise<void>;
};

const startTestServer = async (
  options?: AnthropicMockOptions,
): Promise<TestServer> => {
  const mock = await startAnthropicMock(options);
  return {
    url: mock.url,
    // `retry: 0` keeps assertions on failure responses immediate and
    // deterministic (ky otherwise retries transient connection errors).
    client: ky.create({ prefix: mock.url, retry: 0 }),
    close: mock.close,
  };
};

export type { TestServer };
export { startTestServer };
