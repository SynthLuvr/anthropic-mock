import Fastify, { type FastifyInstance } from "fastify";
import { registerMessagesRoute } from "./messages";
import { registerModelsRoute } from "./models";
import type { AnthropicMockOptions, RunningAnthropicMock } from "./types";

const DEFAULT_HOST = "127.0.0.1";

const createAnthropicMock = (
  options: AnthropicMockOptions = {},
): FastifyInstance => {
  const app = Fastify({ logger: false });
  registerMessagesRoute(app, options);
  registerModelsRoute(app, options);
  return app;
};

const startAnthropicMock = async (
  options: AnthropicMockOptions = {},
): Promise<RunningAnthropicMock> => {
  const app = createAnthropicMock(options);
  const host = options.host ?? DEFAULT_HOST;
  await app.listen({ port: options.port ?? 0, host });
  const address = app.server.address();
  const port =
    address && typeof address === "object" ? address.port : (options.port ?? 0);
  const url = `http://${host}:${port}`;
  const close = async (): Promise<void> => {
    await app.close();
  };
  return { url, close };
};

export { createAnthropicMock, startAnthropicMock };
