import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseRules } from "./schemas";
import type { MockRule } from "./types";

// Loads rules for the standalone server from `LLM_MOCKINGBIRD_RULES`. JSON
// only: llm-mock also accepts YAML/JS configs, but those would add a
// dependency and an eval surface this package deliberately avoids (ADR
// 0008). A bare array or a {"rules": [...]} envelope are both accepted.
const loadRulesFile = (path: string): readonly MockRule[] => {
  let raw: string;
  try {
    raw = readFileSync(resolve(path), "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    throw new Error(
      `llm-mockingbird: cannot read rules file ${path}: ${err.message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `llm-mockingbird: rules file ${path} is not valid JSON: ${(error as Error).message}`,
    );
  }

  return parseRules(parsed, path);
};

export { loadRulesFile };
