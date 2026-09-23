// Merge the model's `css` rewrite and/or `cssAppend` onto the saved CSS; undefined means no change, and a blank never wipes it.
export function mergeGlobalCss({
  existing,
  replace,
  append,
}: {
  existing: string | undefined;
  replace: string | null | undefined;
  append: string | null | undefined;
}): string | undefined {
  const current = existing ?? "";
  const base = replace && replace.trim() ? replace : current;
  // Models sometimes re-emit rules they already added; drop only those still in effect.
  const fresh = splitRules(append?.trim() ?? "").filter(
    (rule) => !isRuleInEffect(base, rule),
  );
  const merged =
    fresh.length > 0
      ? [base.trim(), fresh.join("\n\n")].filter(Boolean).join("\n\n")
      : base;
  return merged && merged !== current ? merged : undefined;
}

// Top-level rules of a stylesheet; a leading comment travels with the rule after it.
function splitRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        rules.push(css.slice(start, i + 1));
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      rules.push(css.slice(start, i + 1));
      start = i + 1;
    }
  }
  rules.push(css.slice(start));
  return rules.map((r) => r.trim()).filter(Boolean);
}

const stripLeadingComments = (rule: string): string =>
  rule.replace(/^(\s*\/\*[\s\S]*?\*\/)*\s*/, "");

// Only at a rule boundary, so `.nav button {…}` doesn't match `button {…}`.
const atRuleBoundary = (css: string, at: number): boolean => {
  const before = css.slice(0, at).trimEnd();
  return before === "" || before.endsWith("}") || before.endsWith("*/");
};

// Index of the last whole-rule occurrence of `text` (or, with `asSelector`, a selector opening a block), or -1.
function findRule(css: string, text: string, asSelector = false): number {
  let found = -1;
  let at = css.indexOf(text);
  while (at !== -1) {
    const opensBlock =
      !asSelector || /^\s*\{/.test(css.slice(at + text.length));
    if (opensBlock && atRuleBoundary(css, at)) found = at;
    at = css.indexOf(text, at + 1);
  }
  return found;
}

// Redundant only while still in effect: a rule a later rule overrides needs appending again.
function isRuleInEffect(css: string, rule: string): boolean {
  const body = stripLeadingComments(rule);
  // A comment on its own adds nothing worth appending.
  if (!body) return true;
  const at = findRule(css, body);
  if (at === -1) return false;
  const brace = body.indexOf("{");
  const selector = brace === -1 ? "" : body.slice(0, brace).trim();
  if (!selector) return true;
  return findRule(css.slice(at + body.length), selector, true) === -1;
}

export interface SkippedItem {
  request: string;
  reason: string;
}

// One bullet per part the model didn't do, below its explanation.
export function appendSkipped(
  explanation: string,
  skipped: SkippedItem[] | null | undefined,
): string {
  const lines = (skipped ?? [])
    .map((s) => ({ request: s.request.trim(), reason: s.reason.trim() }))
    .filter((s) => s.request)
    .map((s) => `• ${s.request}${s.reason ? ` — ${s.reason}` : ""}`);
  if (lines.length === 0) return explanation;
  return [explanation.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
}

// Why a position move can't be applied, or null; worded for both the model and the user.
export function movePlacementProblem(m: {
  attribute: string;
  selector: string;
  parentSelector?: string | null;
  insertBeforeSelector?: string | null;
}): string | null {
  if (m.attribute !== "position") return null;
  if (!m.parentSelector) {
    return "no destination container (parentSelector) was given";
  }
  if (m.parentSelector === m.selector) {
    return "its destination container (parentSelector) is the element itself";
  }
  if (m.insertBeforeSelector === m.selector) {
    return "it would be inserted before itself (insertBeforeSelector is the element itself)";
  }
  return null;
}

// The SDK re-runs variation JS on every re-apply, so an unguarded insert duplicates. Advisory heuristic.
const DOM_INSERT_RE =
  /\.(?:insertAdjacentHTML|insertAdjacentElement|appendChild|insertBefore|replaceChildren|append|prepend|after|before)\s*\(|\.innerHTML\s*\+=/;
const INSERT_GUARD_RE =
  /if\s*\(\s*!?\s*[\w.]*(?:querySelector(?:All)?|getElementById|getElementsByClassName|closest|contains)\s*\(|\bdataset\.\w+|data-gb/;

export function hasUnguardedDomInsert(js: string | null | undefined): boolean {
  if (!js) return false;
  return DOM_INSERT_RE.test(js) && !INSERT_GUARD_RE.test(js);
}

// Selectors a live findElements call matched, plus the query when anything matched.
export function selectorsFoundByTool(result: {
  toolName: string;
  input: unknown;
  output: unknown;
}): string[] {
  if (result.toolName !== "findElements") return [];
  const out = result.output as { ok?: unknown; matches?: unknown } | null;
  if (!out || out.ok !== true || !Array.isArray(out.matches)) return [];
  const found = out.matches.flatMap((m: unknown) => {
    const s = (m as { selector?: unknown } | null)?.selector;
    return typeof s === "string" ? [s] : [];
  });
  const query = (result.input as { selector?: unknown } | null)?.selector;
  return found.length > 0 && typeof query === "string"
    ? [...found, query]
    : found;
}

// A selector the user typed, which the prompt treats as ground truth.
export function isUserNamedSelector(prompt: string, selector: string): boolean {
  return /[.#[]/.test(selector) && prompt.includes(selector);
}
