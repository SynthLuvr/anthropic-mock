import Fastify, { type FastifyInstance } from "fastify";

import { registerAnthropicMessagesRoute } from "./anthropic/messages";
import { registerAnthropicModelsRoute } from "./anthropic/models";
import { registerOpenAIChatCompletionsRoute } from "./openai/chat-completions";
import { registerOpenAIModelsRoute } from "./openai/models";
import { parsePort } from "./schemas";
import type { MockOptions, MockRequest, RunningMock } from "./types";

const DEFAULT_HOST = "127.0.0.1";

// Registers the onRequest observer, when configured, as a preHandler
// hook: the URL and body are final by then, and it still runs before
// the route handler (including hijacked streaming replies).
const registerRequestObserver = (
  app: FastifyInstance,
  options: MockOptions,
): void => {
  const { onRequest } = options;
  if (onRequest)
    app.addHook("preHandler", async (request) => {
      onRequest({ method: request.method, url: request.url });
    });
};

// Each provider owns its own app: both expose GET /v1/models, but the two
// APIs disagree on that response's shape, so they cannot share one server
// (ADR 0005).
const createAnthropicMock = (options: MockOptions = {}): FastifyInstance => {
  const app = Fastify({ logger: false });
  registerRequestObserver(app, options);
  registerAnthropicMessagesRoute(app, options);
  registerAnthropicModelsRoute(app, options);
  return app;
};

const createOpenAIMock = (options: MockOptions = {}): FastifyInstance => {
  const app = Fastify({ logger: false });
  registerRequestObserver(app, options);
  registerOpenAIChatCompletionsRoute(app, options);
  registerOpenAIModelsRoute(app, options);
  return app;
};

const listen = async (
  app: FastifyInstance,
  options: MockOptions,
): Promise<RunningMock> => {
  const host = options.host ?? DEFAULT_HOST;
  await app.listen({ port: options.port ?? 0, host });
  const port = parsePort(app.server.address());
  const url = `http://${host}:${port}`;
  const close = async (): Promise<void> => {
    await app.close();
  };
  return { url, close };
};

const startAnthropicMock = async (
  options: MockOptions = {},
): Promise<RunningMock> => listen(createAnthropicMock(options), options);

const startOpenAIMock = async (
  options: MockOptions = {},
): Promise<RunningMock> => listen(createOpenAIMock(options), options);

export type { MockOptions, MockRequest, RunningMock };
export {
  createAnthropicMock,
  createOpenAIMock,
  startAnthropicMock,
  startOpenAIMock,
};
