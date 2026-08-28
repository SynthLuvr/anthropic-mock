import type { FastifyReply } from "fastify";

import { sleep } from "../sse";
import type { ProviderId, RuleOutcome } from "./types";

// llm-mock's MALFORMED_JSON body: valid headers, truncated payload.
const MALFORMED_JSON_BODY = '{"not":"closed"';

// Status codes map to the error type each real API reports for them.
const ANTHROPIC_STATUS_TYPES: Readonly<Record<number, string>> = {
  400: "invalid_request_error",
  401: "authentication_error",
  403: "permission_error",
  404: "not_found_error",
  413: "request_too_large",
  422: "invalid_request_error",
  429: "rate_limit_error",
  500: "api_error",
  502: "api_error",
  503: "api_error",
  529: "overloaded_error",
};

const OPENAI_STATUS_TYPES: Readonly<Record<number, string>> = {
  400: "invalid_request_error",
  401: "invalid_request_error",
  403: "invalid_request_error",
  404: "invalid_request_error",
  409: "invalid_request_error",
  422: "invalid_request_error",
  429: "rate_limit_error",
  500: "server_error",
  502: "server_error",
  503: "server_error",
  504: "server_error",
};

// Default messages per error type, so a bare {"status": 429} reads like the
// real API rather than "mock error 429".
const ANTHROPIC_TYPE_MESSAGES: Readonly<Record<string, string>> = {
  api_error: "Internal server error",
  authentication_error: "Invalid API key",
  invalid_request_error: "Invalid request",
  not_found_error: "Not found",
  overloaded_error: "Overloaded",
  permission_error: "Permission denied",
  rate_limit_error: "Rate limit reached",
  request_too_large: "Request too large",
};

const OPENAI_TYPE_MESSAGES: Readonly<Record<string, string>> = {
  invalid_request_error: "Invalid request",
  rate_limit_error: "Rate limit reached",
  server_error:
    "The server had an error while processing your request. Sorry about that!",
};

const resolveErrorType = (status: number, provider: ProviderId): string =>
  provider === "anthropic"
    ? (ANTHROPIC_STATUS_TYPES[status] ?? "api_error")
    : (OPENAI_STATUS_TYPES[status] ?? "server_error");

const resolveErrorMessage = (
  errorType: string,
  provider: ProviderId,
): string => {
  const table =
    provider === "anthropic" ? ANTHROPIC_TYPE_MESSAGES : OPENAI_TYPE_MESSAGES;
  return table[errorType] ?? "Mock error";
};

// Anthropic's error body shape: {"type":"error","error":{...}}.
const anthropicErrorBody = (
  status: number,
  errorType?: string,
  errorMessage?: string,
) => {
  const type = errorType ?? resolveErrorType(status, "anthropic");
  return {
    type: "error" as const,
    error: {
      type,
      message: errorMessage ?? resolveErrorMessage(type, "anthropic"),
    },
  };
};

// OpenAI's error body shape: {"error":{...,"param":null,"code":null}}.
const openAIErrorBody = (
  status: number,
  errorType?: string,
  errorMessage?: string,
) => {
  const type = errorType ?? resolveErrorType(status, "openai");
  return {
    error: {
      message: errorMessage ?? resolveErrorMessage(type, "openai"),
      type,
      param: null,
      code: null,
    },
  };
};

const errorBody = (
  status: number,
  provider: ProviderId,
  errorType?: string,
  errorMessage?: string,
) =>
  provider === "anthropic"
    ? anthropicErrorBody(status, errorType, errorMessage)
    : openAIErrorBody(status, errorType, errorMessage);

// Applies a matched rule's faults, the delay first (llm-mock's order).
// Returns true when a fault fully answered the request and the handler must
// return immediately; false when the reply should be served as normal — no
// rule matched, or the outcome set nothing but a delay.
const applyFaults = async (
  reply: FastifyReply,
  provider: ProviderId,
  outcome: RuleOutcome | undefined,
): Promise<boolean> => {
  if (outcome === undefined) return false;
  if (outcome.delayMs !== undefined && outcome.delayMs > 0)
    await sleep(outcome.delayMs);

  if (outcome.timeoutAfterMs !== undefined) {
    // A bounded hang, then socket destruction — llm-mock's TIMEOUT never
    // responds, which would hang tests forever (ADR 0008).
    reply.hijack();
    await sleep(outcome.timeoutAfterMs);
    reply.raw.destroy();
    return true;
  }

  if (outcome.malformedJson === true) {
    reply.header("content-type", "application/json");
    reply.code(200).send(MALFORMED_JSON_BODY);
    return true;
  }

  if (outcome.status !== undefined) {
    if (outcome.retryAfterSec !== undefined)
      reply.header("retry-after", String(outcome.retryAfterSec));
    reply
      .code(outcome.status)
      .send(
        errorBody(
          outcome.status,
          provider,
          outcome.errorType,
          outcome.errorMessage,
        ),
      );
    return true;
  }

  return false;
};

export {
  anthropicErrorBody,
  applyFaults,
  openAIErrorBody,
  resolveErrorMessage,
  resolveErrorType,
};
