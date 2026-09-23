// Merge the model's global-CSS output onto the saved stylesheet. `replace`
// is a full rewrite (to modify or remove an existing rule); `append` is new
// rules only. Both may be present — the rewrite is then the base. Returns
// undefined when nothing changes. Empty strings count as "no change":
// clearing CSS through the AI is deliberately unsupported (that's the manual
// editor's job), so a blank can never wipe the variation.
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
  // Stronger models sometimes re-emit rules they already added. Judge each
  // appended rule on its own: drop the ones still in effect, keep the rest.
  const fresh = splitRules(append?.trim() ?? "").filter(
    (rule) => !isRuleInEffect(base, rule),
  );
  const merged =
    fresh.length > 0
      ? [base.trim(), fresh.join("\n\n")].filter(Boolean).join("\n\n")
      : base;
  return merged && merged !== current ? merged : undefined;
}

// Top-level rules of a stylesheet: a `selector { … }` block (a nested block
// such as @media stays whole) or a `@import …;` statement. Comments and
// strings are skipped for nesting, and a leading comment travels with the
// rule that follows it.
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

// A rule (or bare selector) only counts where it starts the stylesheet or
// follows the end of a previous rule or comment: `.nav button {…}` must not
// match `button {…}`.
const atRuleBoundary = (css: string, at: number): boolean => {
  const before = css.slice(0, at).trimEnd();
  return before === "" || before.endsWith("}") || before.endsWith("*/");
};

// Index of the last whole-rule occurrence of `text` — a full rule, or with
// `asSelector` a selector that opens a block — or -1.
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

// An appended rule is redundant only while it is still in effect: present
// whole, with no later rule re-targeting its selector. A rule that a later
// rule overrides is not "already there" — appending it again is exactly how
// the cascade gets it back.
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

// Surface the parts the model didn't do below its explanation, one bullet
// each, so a partial result reads as one rather than a silent omission.
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
