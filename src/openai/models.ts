import type { FastifyInstance } from "fastify";

import type { MockOptions } from "../types";
import type { OpenAIModel } from "./schemas";

const DEFAULT_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1"] as const;
// Same fixed epoch the chat-completions route stamps on every response.
const DEFAULT_CREATED = 1735689600;

const toModel = (id: string): OpenAIModel => ({
  id,
  object: "model",
  created: DEFAULT_CREATED,
  owned_by: "system",
});

const registerOpenAIModelsRoute = (
  app: FastifyInstance,
  options: MockOptions,
): void => {
  const models = options.models ?? DEFAULT_MODELS;
  app.get("/v1/models", async (_request, reply) =>
    reply.send({ object: "list", data: models.map(toModel) }),
  );
};

export { registerOpenAIModelsRoute };
