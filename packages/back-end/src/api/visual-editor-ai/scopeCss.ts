// Scopes a stylesheet under a single root selector so an AI-generated
// design component can't leak styles into the host page.
//
// The Figma → Variant model is instructed to prefix every rule with the
// injected root's class (`.gbf-<token>`), but models routinely emit bare
// `button {}` / `:root {}` / global resets anyway. This is the mandatory
// safety net: it rewrites any top-level style-rule selector that isn't
// already scoped, maps `:root`/`html`/`body` onto the root, and recurses
// into conditional group rules (@media/@supports/@container/@layer).
// `@keyframes`, `@font-face`, `@page`, `@import`, `@charset`, etc. pass
// through untouched (their inner selectors aren't page selectors).
//
// This is a pragmatic tokenizer, not a full CSS parser — it handles the
// shapes models actually produce (flat rules + one or more levels of
// conditional group rules). Pure + deterministic so it can be unit-tested.

const GROUP_AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "layer", // only the block form; the @layer statement form is handled below
]);

// At-rules whose block body is NOT a list of style rules — leave them be.
const PASSTHROUGH_AT_RULES = new Set([
  "keyframes",
  "-webkit-keyframes",
  "font-face",
  "font-feature-values",
  "page",
  "property",
  "counter-style",
]);

function atRuleName(prelude: string): string | null {
  const m = prelude.trim().match(/^@([\w-]+)/);
  return m ? m[1].toLowerCase() : null;
}

// Prefix a single comma-separated selector list with the scope selector.
function scopeSelectorList(selectorList: string, scope: string): string {
  return selectorList
    .split(",")
    .map((sel) => {
      const trimmed = sel.trim();
      if (!trimmed) return trimmed;
      // Already scoped — don't double-prefix.
      if (trimmed === scope || trimmed.includes(scope)) return trimmed;
      // Map page-global roots onto the component root.
      if (
        trimmed === ":root" ||
        trimmed === "html" ||
        trimmed === "body" ||
        trimmed === "*"
      ) {
        return scope;
      }
      // The component root itself, addressed bare (rare) — keep scoped.
      return `${scope} ${trimmed}`;
    })
    .join(", ");
}

export function scopeCss(css: string, scopeSelector: string): string {
  if (!css || !css.trim()) return "";

  const out: string[] = [];
  let i = 0;
  const n = css.length;

  while (i < n) {
    // Skip leading whitespace between rules.
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;

    // Read a prelude until we hit `{` (a block) or `;` (a statement at-rule).
    let prelude = "";
    while (i < n && css[i] !== "{" && css[i] !== ";") {
      prelude += css[i];
      i++;
    }

    if (i >= n) {
      // Trailing junk with no block — drop it.
      break;
    }

    if (css[i] === ";") {
      // Statement at-rule (@charset, @layer a,b; etc.) — pass through, but
      // strip @import: it loads global, unscopable stylesheets and could
      // pull in external resources.
      if (atRuleName(prelude.trim()) !== "import") {
        out.push(`${prelude.trim()};`);
      }
      i++; // consume ';'
      continue;
    }

    // css[i] === "{" — read the balanced block body.
    i++; // consume '{'
    let depth = 1;
    let body = "";
    while (i < n && depth > 0) {
      const ch = css[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          i++; // consume closing '}'
          break;
        }
      }
      body += ch;
      i++;
    }

    const trimmedPrelude = prelude.trim();
    const at = atRuleName(trimmedPrelude);

    if (at) {
      if (GROUP_AT_RULES.has(at)) {
        // Conditional group rule — recurse into its body.
        out.push(`${trimmedPrelude} { ${scopeCss(body, scopeSelector)} }`);
      } else if (PASSTHROUGH_AT_RULES.has(at)) {
        out.push(`${trimmedPrelude} { ${body.trim()} }`);
      } else {
        // Unknown at-rule with a block — pass through to be safe.
        out.push(`${trimmedPrelude} { ${body.trim()} }`);
      }
      continue;
    }

    // Plain style rule.
    const scopedSelector = scopeSelectorList(trimmedPrelude, scopeSelector);
    out.push(`${scopedSelector} { ${body.trim()} }`);
  }

  return out.join("\n");
}
