import { randomBytes } from "crypto";
import * as cheerio from "cheerio";
import type { VisualChange } from "shared/types/visual-changeset";
import { BadRequestError } from "back-end/src/util/errors";

// Elements whose content is raw text in HTML but live markup when the mutation
// targets an SVG/MathML element, so their text is re-checked as HTML.
const RAW_TEXT_ELEMENTS = new Set([
  "style",
  "title",
  "textarea",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
]);

// Browsers ignore control characters when parsing a URL scheme.
const hasJsUrl = (value: string) =>
  /javascript:/i.test(value.replace(/[^\x20-￿]/g, ""));

function attributeProblem(name: string, value: string): string | null {
  if (/^on/i.test(name)) return `event handler attribute "${name}"`;
  if (/^srcdoc$/i.test(name)) return `"srcdoc" attribute`;
  if (hasJsUrl(value)) return `javascript: URL in "${name}"`;
  return null;
}

function htmlProblem(html: string): string | null {
  // The sentinel only survives as an element if the fragment ends outside any
  // tag, comment or raw-text element. That keeps a payload from being split
  // across two appended fragments that are each harmless on their own.
  // Its name is random so the fragment can't supply a decoy of its own.
  const sentinel = `gb-end-${randomBytes(8).toString("hex")}`;
  const $ = cheerio.load(html + `<${sentinel}></${sentinel}>`, null, false);
  if (!$(sentinel).length) return "unclosed tag or comment";

  for (const el of $("*").toArray()) {
    if (!("attribs" in el)) continue;
    const tag = el.name.toLowerCase();
    if (tag === "script" || tag === "base") return `<${tag}> element`;
    for (const [name, value] of Object.entries(el.attribs)) {
      const problem = attributeProblem(name, value);
      if (problem) return problem;
    }
    if (RAW_TEXT_ELEMENTS.has(tag)) {
      const problem = htmlProblem($(el).text());
      if (problem) return problem;
    }
  }
  return null;
}

function cssProblem(css: string): string | null {
  // "</style" breaks out of the <style> tag when CSS is injected server-side.
  if (/<\/style/i.test(css)) return `"</style"`;
  if (/expression\s*\(/i.test(css)) return "expression()";
  if (hasJsUrl(css)) return "javascript: URL";
  return null;
}

function mutationValueProblem({
  action,
  attribute,
  value = "",
}: VisualChange["domMutations"][number]): string | null {
  if (attribute === "html") return htmlProblem(value);
  // Applied via classList / DOM moves, never as markup.
  if (["class", "className", "position"].includes(attribute)) return null;

  const problem = attributeProblem(attribute, value);
  if (problem) return problem;

  // An append could complete a "javascript:" scheme started by another change.
  const scheme = value.replace(/[^\x20-￿]/g, "").split(":");
  if (
    action === "append" &&
    scheme.length > 1 &&
    "javascript".endsWith(scheme[0].toLowerCase())
  ) {
    return `javascript: URL in "${attribute}"`;
  }
  return null;
}

function mutationProblem(
  mutation: VisualChange["domMutations"][number],
): string | null {
  const problem = mutationValueProblem(mutation);
  return problem && `${problem} in the mutation for "${mutation.selector}"`;
}

type CheckedChange = Partial<
  Pick<VisualChange, "id" | "variation" | "css" | "domMutations">
>;

// The fields the checks below read, so a change that round-trips untouched
// compares equal whatever else differs.
const checkedFields = ({ css, domMutations }: CheckedChange) =>
  JSON.stringify([
    css || "",
    (domMutations ?? []).map((m) => [m.action, m.attribute, m.value ?? ""]),
  ]);

// JavaScript belongs in a visual change's `js` field, which organizations can
// block. Reject every other way of smuggling it in.
//
// A change identical to its `stored` version is skipped: it is already live,
// and rejecting it would block saves that fix a different variation.
export function assertNoInjectedJs(
  visualChanges: CheckedChange[],
  {
    stored = [],
    variations = [],
  }: {
    stored?: VisualChange[];
    variations?: { id: string; name: string }[];
  } = {},
): void {
  for (const change of visualChanges) {
    const existing = stored.find((c) => c.id === change.id);
    if (existing && checkedFields(existing) === checkedFields(change)) continue;

    const { css, domMutations } = change;
    const cssFound = css ? cssProblem(css) : null;
    const problem = cssFound
      ? `${cssFound} in the global CSS`
      : (domMutations ?? []).map(mutationProblem).find(Boolean);
    if (problem) {
      const variationId = change.variation ?? existing?.variation;
      const variation = variations.find((v) => v.id === variationId);
      throw new BadRequestError(
        `Visual changes cannot contain JavaScript outside of the custom JS field (found ${problem}${
          variation ? `, variation "${variation.name}"` : ""
        })`,
      );
    }
  }
}
