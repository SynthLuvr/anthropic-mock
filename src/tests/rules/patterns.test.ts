import { describe, expect, it } from "vitest";

import { compilePattern, interpolate } from "../../rules/patterns";

describe("compilePattern", () => {
  it("matches a literal case-insensitively across whitespace runs", () => {
    const match = compilePattern("explain this please");
    expect(match("Explain   THIS\tplease")).toEqual({});
    expect(match("please explain this")).toBeNull();
    expect(match("explain this please now")).toBeNull();
  });

  it("ignores leading and trailing whitespace in the input", () => {
    const match = compilePattern("hello");
    expect(match("  hello  ")).toEqual({});
  });

  it("captures {{var}} values, trimmed", () => {
    const match = compilePattern("my name is {{name}}");
    expect(match("My name is  Ada Lovelace ")).toEqual({
      name: "Ada Lovelace",
    });
  });

  it("captures a trailing variable to the end of the input, like llm-mock", () => {
    const match = compilePattern("my name is {{name}}");
    expect(match("my name is Ada Lovelace, esq.")).toEqual({
      name: "Ada Lovelace, esq.",
    });
  });

  it("captures multiple variables", () => {
    const match = compilePattern("book {{title}} by {{author}}");
    expect(match("book Frankenstein by Mary Shelley")).toEqual({
      title: "Frankenstein",
      author: "Mary Shelley",
    });
  });

  it("escapes regex metacharacters in literal text", () => {
    const match = compilePattern("a+b (c) [d] . e");
    expect(match("a+b (c) [d] . e")).toEqual({});
    expect(match("aab c d  e")).toBeNull();
  });

  it("requires the whole input to match around the template", () => {
    const match = compilePattern("hi {{name}}!!");
    expect(match("hi Ada!!")).toEqual({ name: "Ada" });
    expect(match("hi there!! and more")).toBeNull();
    expect(match("well hi Ada!!")).toBeNull();
  });
});

describe("interpolate", () => {
  it("replaces {{var}} references with captured values", () => {
    expect(interpolate("Hello {{name}}!", { name: "Ada" })).toBe("Hello Ada!");
  });

  it("replaces unknown variables with the empty string", () => {
    expect(interpolate("Hello {{name}}!", {})).toBe("Hello !");
  });

  it("interpolates a variable more than once", () => {
    expect(interpolate("{{x}} and {{x}}", { x: "1" })).toBe("1 and 1");
  });

  it("leaves templates without placeholders untouched", () => {
    expect(interpolate("plain reply", {})).toBe("plain reply");
  });
});
