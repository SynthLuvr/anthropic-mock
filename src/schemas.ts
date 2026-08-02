import type { AddressInfo } from "node:net";
import { type } from "arktype";

const anthropicRequest = type({
  "model?": "string",
  "messages?": "unknown[]",
  "max_tokens?": "number",
  "stream?": "boolean",
  "system?": "unknown",
  "temperature?": "number",
  "tools?": "unknown[]",
});

const listeningAddress = type({
  address: "string",
  family: "string",
  port: "number",
});

const parseRequest = (raw: unknown): AnthropicRequest => {
  const result = anthropicRequest(raw);
  // A mock is deliberately lenient: a malformed body falls back to defaults
  // instead of rejecting the request.
  return result instanceof type.errors ? {} : result;
};

const parsePort = (address: AddressInfo | string | null): number => {
  const result = listeningAddress(address);
  if (result instanceof type.errors)
    throw new Error("expected the server to be listening on a TCP port");
  return result.port;
};

type AnthropicRequest = typeof anthropicRequest.infer;

export type { AnthropicRequest };
export { parsePort, parseRequest };
