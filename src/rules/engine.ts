import { compilePattern, interpolate, type PatternMatcher } from "./patterns";
import type {
  MockRule,
  RuleEngine,
  RuleGuard,
  RuleOutcome,
  RuleRequestContext,
  RuleWhen,
} from "./types";

// True when `candidate` is the value, or a list containing it.
const includesValue = (
  candidate: string | readonly string[],
  value: string,
): boolean =>
  typeof candidate === "string"
    ? candidate === value
    : candidate.includes(value);

// Header names are case-insensitive: fastify lowercases its request header
// keys, so lookups compare against the lowercased condition name. Repeated
// headers arrive as arrays and match when any member equals the value.
const headersMatch = (
  headers: Readonly<Record<string, string>> | undefined,
  requestHeaders: Readonly<Record<string, unknown>>,
): boolean => {
  if (headers === undefined) return true;
  for (const [name, value] of Object.entries(headers)) {
    const actual = requestHeaders[name.toLowerCase()];
    const matched = Array.isArray(actual)
      ? actual.some((entry) => entry === value)
      : actual === value;
    if (!matched) return false;
  }
  return true;
};

const whenMatches = (when: RuleWhen, context: RuleRequestContext): boolean => {
  if (
    when.provider !== undefined &&
    !includesValue(when.provider, context.provider)
  )
    return false;
  if (when.model !== undefined && !includesValue(when.model, context.model))
    return false;
  if (!headersMatch(when.headers, context.headers)) return false;
  if (when.stream !== undefined && when.stream !== context.stream) return false;
  return true;
};

// The guard mini-DSL, identical to llm-mock: equals/includes/oneOf compare
// case-insensitively, matches is a case-sensitive regex test. A missing
// variable guards against "" (llm-mock coerces undefined the same way).
const guardPasses = (
  guard: RuleGuard,
  vars: Readonly<Record<string, string>>,
): boolean => {
  const actual = vars[guard.var] ?? "";
  switch (guard.op) {
    case "equals":
      return actual.toLowerCase() === (guard.value ?? "").toLowerCase();
    case "includes":
      return actual.toLowerCase().includes((guard.value ?? "").toLowerCase());
    case "oneOf":
      return (guard.values ?? []).some(
        (value) => actual.toLowerCase() === value.toLowerCase(),
      );
    case "matches":
      return new RegExp(guard.value ?? "").test(actual);
  }
};

// The reply template for a rule's nth match: a sequence walks its entries
// and repeats the last one forever; without a sequence, the single reply.
// A sequence wins over `reply` when both are present.
const replyTemplate = (rule: MockRule, hits: number): string | undefined => {
  if (rule.sequence !== undefined && rule.sequence.length > 0)
    return rule.sequence[Math.min(hits, rule.sequence.length - 1)];
  return rule.reply;
};

type CompiledRule = {
  readonly rule: MockRule;
  readonly pattern: PatternMatcher | undefined;
  hits: number;
};

// Builds the engine that routes requests to rules: the first rule whose
// when conditions, pattern, guard, and ratio roll succeed wins. Sequence
// state is per rule and per engine (i.e. per mock instance).
const createRuleEngine = (
  rules: readonly MockRule[] | undefined,
): RuleEngine | undefined => {
  if (rules === undefined || rules.length === 0) return undefined;

  const compiled: CompiledRule[] = rules.map((rule) => ({
    rule,
    pattern:
      rule.when.pattern === undefined
        ? undefined
        : compilePattern(rule.when.pattern),
    hits: 0,
  }));

  const match = (context: RuleRequestContext): RuleOutcome | undefined => {
    for (const entry of compiled) {
      const { rule } = entry;
      if (!whenMatches(rule.when, context)) continue;
      const vars =
        entry.pattern === undefined ? {} : entry.pattern(context.text);
      if (vars === null) continue;
      if (rule.guard !== undefined && !guardPasses(rule.guard, vars)) continue;
      // The ratio roll happens before the sequence counter advances, so a
      // skipped request does not consume a sequence step.
      if (rule.ratio !== undefined && Math.random() >= rule.ratio) continue;

      const template = replyTemplate(rule, entry.hits);
      entry.hits += 1;
      return {
        reply: template === undefined ? undefined : interpolate(template, vars),
        status: rule.status,
        retryAfterSec: rule.retryAfterSec,
        errorType: rule.errorType,
        errorMessage: rule.errorMessage,
        malformedJson: rule.malformedJson,
        timeoutAfterMs: rule.timeoutAfterMs,
        delayMs: rule.delayMs,
      };
    }
    return undefined;
  };

  return { match };
};

// The text rules are matched against: the last user message's content,
// joining the text parts of array content (both providers use the same
// role/content message shape). Adapted from llm-mock's
// extractUserTextFromOpenAI.
const extractUserText = (body: unknown): string => {
  if (typeof body !== "object" || body === null) return "";
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return "";
  const lastUser = [...messages]
    .reverse()
    .find(
      (message): message is { content: unknown } =>
        typeof message === "object" &&
        message !== null &&
        (message as { role?: unknown }).role === "user",
    );
  if (lastUser === undefined) return "";
  if (typeof lastUser.content === "string") return lastUser.content;
  if (!Array.isArray(lastUser.content)) return "";
  return lastUser.content
    .map((part) =>
      typeof part === "object" &&
      part !== null &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join(" ");
};

export { createRuleEngine, extractUserText };
