import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RESPONSES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "responses",
);

// Seeded mulberry32 PRNG so fixtures are byte-for-byte stable across
// regenerations, keeping lint and the reassembly tests reproducible.
const createRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SUBJECTS = [
  "the scheduler",
  "a streaming token",
  "an event source",
  "the mock server",
  "a backpressure signal",
  "the retry policy",
  "a content block",
  "the session",
] as const;

const VERBS = [
  "resumes",
  "flushes",
  "blocks",
  "negotiates",
  "deschedules",
  "emits",
  "reconnects",
  "throttles",
] as const;

const OBJECTS = [
  "the pending frame",
  "its buffered deltas",
  "a partial response",
  "the upstream cursor",
  "a keepalive comment",
  "the hijacked socket",
  "a canonical event order",
  "the next chunk",
] as const;

const ADVERBS = [
  "promptly",
  "lazily",
  "idempotently",
  "eagerly",
  "once",
] as const;

const pick = <T,>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)]!;

const capitalize = (value: string): string =>
  value[0]!.toUpperCase() + value.slice(1);

const sentence = (rng: () => number): string =>
  `${capitalize(pick(rng, SUBJECTS))} ${pick(rng, VERBS)} ${pick(rng, ADVERBS)} ${pick(rng, OBJECTS)}.`;

const paragraph = (rng: () => number, count: number): string =>
  Array.from({ length: count }, () => sentence(rng)).join(" ");

const numbered = (rng: () => number, count: number): string =>
  Array.from(
    { length: count },
    (_, i) => `${i + 1}. ${paragraph(rng, 1)}`,
  ).join("\n");

const codeBlock = (rng: () => number): string => {
  const delay = Math.floor(rng() * 40) + 5;
  return [
    "```ts",
    `const delay = ${delay};`,
    `const frame = await readFrame({ delay });`,
    "console.log(frame.toString());",
    "```",
  ].join("\n");
};

const writeResponse = (name: string, body: string): void => {
  writeFileSync(join(RESPONSES_DIR, name), `${body}\n`);
};

const generate = (): void => {
  mkdirSync(RESPONSES_DIR, { recursive: true });
  const greeting = createRng(1);
  const recipe = createRng(42);
  const essay = createRng(1337);

  writeResponse(
    "greeting.md",
    ["# Greeting", "", paragraph(greeting, 2)].join("\n"),
  );

  writeResponse(
    "recipe.md",
    [
      "# Streaming Recipe",
      "",
      paragraph(recipe, 2),
      "",
      "## Steps",
      "",
      numbered(recipe, 4),
      "",
      "## Example",
      "",
      codeBlock(recipe),
    ].join("\n"),
  );

  writeResponse(
    "essay.md",
    [
      "# An Essay on Mocked Streams",
      "",
      paragraph(essay, 3),
      "",
      "## Background",
      "",
      paragraph(essay, 3),
      "",
      "> " + paragraph(essay, 1),
      "",
      "## Observations",
      "",
      "- " + paragraph(essay, 1),
      "- " + paragraph(essay, 1),
      "- " + paragraph(essay, 1),
      "",
      "```ts",
      "for (const event of events)",
      "  raw.write(serialize(event));",
      "```",
    ].join("\n"),
  );
};

generate();
console.log(`generated responses in ${RESPONSES_DIR}`);
