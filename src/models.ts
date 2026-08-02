import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AnthropicMockOptions, AnthropicModel } from "./types";

const DEFAULT_MODELS = [
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  "claude-haiku-4-5",
] as const;

const toModel = (id: string): AnthropicModel => ({
  id,
  type: "model",
  display_name: id,
});

const registerModelsRoute = (
  app: FastifyInstance,
  options: AnthropicMockOptions,
): void => {
  const models = options.models ?? DEFAULT_MODELS;
  app.get("/v1/models", async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.send({ data: models.map(toModel) }),
  );
};

export { registerModelsRoute };
