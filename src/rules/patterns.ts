type PatternVars = Record<string, string>;

// A compiled `when.pattern` template: given the request text, returns the
// captured variables or null when the text does not match.
type PatternMatcher = (input: string) => PatternVars | null;

// {{var}} placeholders; names are identifiers so they can double as JS
// named-group names when compiled to a regex.
const PLACEHOLDER = /\{\{([a-zA-Z0-9_]+)\}\}/g;

// Regex metacharacters escaped so pattern literals match verbatim.
const escapeLiteral = (text: string): string =>
  text.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

type PatternPart = { readonly literal: string } | { readonly name: string };

// Compiles a {{var}} template into an anchored, case-insensitive,
// whitespace-tolerant matcher: literal runs match any whitespace in their
// place, captured values are trimmed, and the whole template must consume
// the whole input (llm-mock's compileTemplateRegex, minus its fuzzy loose
// mode — ADR 0008 keeps matching deterministic).
const compilePattern = (pattern: string): PatternMatcher => {
  const parts: PatternPart[] = [];
  let last = 0;
  for (const match of pattern.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ literal: pattern.slice(last, index) });
    parts.push({ name: match[1] });
    last = index + match[0].length;
  }
  if (last < pattern.length) parts.push({ literal: pattern.slice(last) });

  let source = "^\\s*";
  for (const part of parts)
    if ("literal" in part)
      source += escapeLiteral(part.literal).replace(/\s+/g, "\\s+");
    else source += `(?<${part.name}>.+?)`;

  source += "\\s*$";
  const regex = new RegExp(source, "i");

  return (input) => {
    const match = regex.exec(input);
    if (match === null) return null;
    // Literal-only patterns have no named groups; their match yields {}.
    const vars: PatternVars = {};
    for (const [name, value] of Object.entries(match.groups ?? {}))
      vars[name] = value.trim();
    return vars;
  };
};

// Renders {{var}} references in a reply template; unknown names become "".
const interpolate = (template: string, vars: Readonly<PatternVars>): string =>
  template.replace(PLACEHOLDER, (_match, name: string) => vars[name] ?? "");

export type { PatternMatcher };
export { compilePattern, interpolate };
