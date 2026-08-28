import { type } from "arktype";

import type { MockRule } from "./types";

// Every {{...}} occurrence must be a single well-formed identifier so the
// compiled regex's named groups are valid (JS group names cannot start with
// a digit).
const PLACEHOLDER_LIKE = /\{\{[^}]*\}\}/g;
const PLACEHOLDER_EXACT = /^\{\{[A-Za-z_][A-Za-z0-9_]*\}\}$/;

const validPatternPlaceholders = (pattern: string): boolean => {
  for (const match of pattern.matchAll(PLACEHOLDER_LIKE))
    if (!PLACEHOLDER_EXACT.test(match[0])) return false;
  return true;
};

// A rule must produce something: a reply, a sequence, or any fault outcome
// (delayMs alone is meaningful — it delays the fallback reply).
const hasOutcome = (rule: {
  reply?: string;
  sequence?: string[];
  status?: number;
  malformedJson?: boolean;
  timeoutAfterMs?: number;
  delayMs?: number;
}): boolean =>
  rule.reply !== undefined ||
  (rule.sequence !== undefined && rule.sequence.length > 0) ||
  rule.status !== undefined ||
  rule.malformedJson === true ||
  rule.timeoutAfterMs !== undefined ||
  rule.delayMs !== undefined;

const ruleGuard = type({
  op: "'equals' | 'includes' | 'oneOf' | 'matches'",
  var: "string",
  "value?": "string",
  "values?": "string[]",
});

const ruleWhen = type({
  "pattern?": "string",
  "provider?": "string | string[]",
  "model?": "string | string[]",
  "headers?": "Record<string, string>",
  "stream?": "boolean",
}).narrow((when, ctx) =>
  when.pattern === undefined || validPatternPlaceholders(when.pattern)
    ? true
    : ctx.mustBe("a template whose {{var}} placeholders are identifiers"),
);

const mockRuleSchema = type({
  when: ruleWhen,
  "reply?": "string",
  "sequence?": "string[]",
  "ratio?": "0 <= number <= 1",
  "guard?": ruleGuard,
  "status?": "number.integer",
  "retryAfterSec?": "number",
  "errorType?": "string",
  "errorMessage?": "string",
  "malformedJson?": "boolean",
  "timeoutAfterMs?": "number >= 0",
  "delayMs?": "number >= 0",
})
  .onUndeclaredKey("reject")
  .narrow(hasOutcome);

// A rules file is either a bare array or a {"rules": [...]} envelope.
const rulesEnvelopeSchema = type({ rules: mockRuleSchema.array() });

// Validates raw JSON into rules, throwing a readable error naming the
// source (the file path, or "rules") when anything is off.
const parseRules = (raw: unknown, source: string): readonly MockRule[] => {
  // A non-array input that is not a valid envelope falls through to the
  // array validation, whose error names the actual shape problem.
  const envelope = Array.isArray(raw) ? undefined : rulesEnvelopeSchema(raw);
  const candidate =
    envelope === undefined || envelope instanceof type.errors
      ? raw
      : envelope.rules;
  const result = mockRuleSchema.array()(candidate);
  if (result instanceof type.errors)
    throw new Error(
      `llm-mockingbird: invalid rules in ${source}: ${result.summary}`,
    );

  return result;
};

export { mockRuleSchema, parseRules };
