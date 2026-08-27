import Fastify, { type FastifyInstance } from "fastify";

import { registerAnthropicMessagesRoute } from "./anthropic/messages";
import { registerAnthropicModelsRoute } from "./anthropic/models";
import { registerOpenAIChatCompletionsRoute } from "./openai/chat-completions";
import { registerOpenAIModelsRoute } from "./openai/models";
import { parsePort } from "./schemas";
import type { MockOptions, MockRequest, RunningMock } from "./types";

const DEFAULT_HOST = "127.0.0.1";

// preHandler rather than fastify's onRequest hook: the URL and body are
// final there, and it still runs before route handlers — including the
// hijacked replies used for streaming. The hook must be async: fastify
// 5.11 on Node 26 hangs on synchronous lifecycle hooks.
const registerRequestObserver = (
  app: FastifyInstance,
  observer: MockOptions["onRequest"],
): void => {
  if (!observer) return;
  app.addHook("preHandler", async (request) => {
    observer({ method: request.method, url: request.url });
  });
};

// Each provider owns its own app: both expose GET /v1/models, but the two
// APIs disagree on that response's shape, so they cannot share one server
// (ADR 0005).
const createAnthropicMock = (options: MockOptions = {}): FastifyInstance => {
  const app = Fastify({ logger: false });
  registerRequestObserver(app, options.onRequest);
  registerAnthropicMessagesRoute(app, options);
  registerAnthropicModelsRoute(app, options);
  return app;
};

const createOpenAIMock = (options: MockOptions = {}): FastifyInstance => {
  const app = Fastify({ logger: false });
  registerRequestObserver(app, options.onRequest);
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
