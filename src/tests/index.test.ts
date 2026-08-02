import { describe, expect, it } from "vitest";

import { createAnthropicMock } from "../index";

describe("createAnthropicMock", () => {
  it("uses the default messages endpoint", () => {
    expect(createAnthropicMock().url).toBe("/v1/messages");
  });

  it("accepts a custom url", () => {
    expect(createAnthropicMock("/custom").url).toBe("/custom");
  });
});
