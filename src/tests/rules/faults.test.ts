import { describe, expect, it } from "vitest";

import {
  anthropicErrorBody,
  openAIErrorBody,
  resolveErrorMessage,
  resolveErrorType,
} from "../../rules/faults";

describe("resolveErrorType (unit)", () => {
  it("maps anthropic statuses to anthropic error types", () => {
    expect(resolveErrorType(400, "anthropic")).toBe("invalid_request_error");
    expect(resolveErrorType(401, "anthropic")).toBe("authentication_error");
    expect(resolveErrorType(403, "anthropic")).toBe("permission_error");
    expect(resolveErrorType(404, "anthropic")).toBe("not_found_error");
    expect(resolveErrorType(429, "anthropic")).toBe("rate_limit_error");
    expect(resolveErrorType(500, "anthropic")).toBe("api_error");
    expect(resolveErrorType(529, "anthropic")).toBe("overloaded_error");
  });

  it("falls back to api_error for unmapped anthropic statuses", () => {
    expect(resolveErrorType(418, "anthropic")).toBe("api_error");
  });

  it("maps openai statuses to openai error types", () => {
    expect(resolveErrorType(400, "openai")).toBe("invalid_request_error");
    expect(resolveErrorType(401, "openai")).toBe("invalid_request_error");
    expect(resolveErrorType(422, "openai")).toBe("invalid_request_error");
    expect(resolveErrorType(429, "openai")).toBe("rate_limit_error");
    expect(resolveErrorType(500, "openai")).toBe("server_error");
    expect(resolveErrorType(503, "openai")).toBe("server_error");
    expect(resolveErrorType(418, "openai")).toBe("server_error");
  });
});

describe("resolveErrorMessage (unit)", () => {
  it("derives a message from the error type per provider", () => {
    expect(resolveErrorMessage("rate_limit_error", "anthropic")).toBe(
      "Rate limit reached",
    );
    expect(resolveErrorMessage("server_error", "openai")).toBe(
      "The server had an error while processing your request. Sorry about that!",
    );
  });

  it("falls back to a generic message for unknown types", () => {
    expect(resolveErrorMessage("exotic_error", "openai")).toBe("Mock error");
  });
});

describe("provider error bodies (unit)", () => {
  it("builds the anthropic shape with mapped type and message", () => {
    expect(anthropicErrorBody(429)).toEqual({
      type: "error",
      error: { type: "rate_limit_error", message: "Rate limit reached" },
    });
  });

  it("honours anthropic errorType and errorMessage overrides", () => {
    expect(anthropicErrorBody(500, "custom_type", "custom message")).toEqual({
      type: "error",
      error: { type: "custom_type", message: "custom message" },
    });
  });

  it("derives the default message for an overridden type", () => {
    expect(anthropicErrorBody(500, "not_found_error")).toEqual({
      type: "error",
      error: { type: "not_found_error", message: "Not found" },
    });
    expect(anthropicErrorBody(500, "exotic_error")).toEqual({
      type: "error",
      error: { type: "exotic_error", message: "Mock error" },
    });
  });

  it("builds the openai shape with param/code nulls", () => {
    expect(openAIErrorBody(429)).toEqual({
      error: {
        message: "Rate limit reached",
        type: "rate_limit_error",
        param: null,
        code: null,
      },
    });
  });

  it("honours openai errorType and errorMessage overrides", () => {
    expect(openAIErrorBody(401, "custom_type", "custom message")).toEqual({
      error: {
        message: "custom message",
        type: "custom_type",
        param: null,
        code: null,
      },
    });
  });
});
