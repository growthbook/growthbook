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

// Never read as a URL, so copy such as "JavaScript: a primer" is allowed.
const isTextAttribute = (name: string) =>
  /^(alt|title|placeholder|aria-.+)$/i.test(name);

function attributeProblem(name: string, value: string): string | null {
  if (/^on/i.test(name)) return `event handler attribute "${name}"`;
  if (/^srcdoc$/i.test(name)) return `"srcdoc" attribute`;
  if (isTextAttribute(name)) return null;
  if (hasJsUrl(value)) return `javascript: URL in "${name}"`;
  return null;
}

// parse5 slows quadratically with nesting depth; this many nested tags takes
// about a second. The largest HTML mutation in production has under 5,000.
const MAX_HTML_TAGS = 20000;

function htmlProblem(html: string): string | null {
  if (html.split("<").length > MAX_HTML_TAGS) {
    throw new BadRequestError(
      `HTML in a visual change cannot have more than ${MAX_HTML_TAGS.toLocaleString("en-US")} tags`,
    );
  }

  // The sentinel only survives as an element if the fragment ends outside any
  // tag, comment or raw-text element. That keeps a payload from being split
  // across two appended fragments that are each harmless on their own.
  // Its name is random so the fragment can't supply a decoy of its own.
  const sentinel = `gb-end-${randomBytes(8).toString("hex")}`;

  // parse5 drops tags a browser keeps in some places: most tags inside a
  // <select> (kept by browsers with customizable select), and <body> or <td>
  // when the mutation targets <html> or a table row. So the fragment is also
  // parsed with <select> renamed, and by htmlparser2, which keeps every tag.
  const unselected = html.replace(/(<\/?)select(?=[\s/>])/gi, "$1gb-select");
  const passes = [
    [html, null],
    [html, { xml: { xmlMode: false } }],
    ...(unselected === html ? [] : [[unselected, null] as const]),
  ] as const;

  // Collected across passes so each distinct text is only checked once.
  const rawTexts = new Set<string>();
  for (const [source, parser] of passes) {
    const $ = cheerio.load(
      source + `<${sentinel}></${sentinel}>`,
      parser,
      false,
    );
    if (!$(sentinel).length) return "unclosed tag or comment";

    for (const el of $("*").toArray()) {
      if (!("attribs" in el)) continue;
      const tag = el.name.toLowerCase();
      if (tag === "script" || tag === "base") return `<${tag}> element`;
      for (const [name, value] of Object.entries(el.attribs)) {
        const problem = attributeProblem(name, value);
        if (problem) return problem;
      }
      if (RAW_TEXT_ELEMENTS.has(tag)) rawTexts.add($(el).text());
    }
  }
  for (const text of rawTexts) {
    const problem = htmlProblem(text);
    if (problem) return problem;
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
  // Removing an attribute, or emptying one, is how a stored handler is cleared.
  if (action === "remove" || !value) return null;
  if (attribute === "html") return htmlProblem(value);
  // Applied via classList / DOM moves, never as markup.
  if (["class", "className", "position"].includes(attribute)) return null;

  const problem = attributeProblem(attribute, value);
  if (problem) return problem;

  // An append could complete a "javascript:" scheme started by another change.
  const scheme = value.replace(/[^\x20-￿]/g, "").split(":");
  if (
    action === "append" &&
    !isTextAttribute(attribute) &&
    scheme.length > 1 &&
    "javascript".endsWith(scheme[0].toLowerCase())
  ) {
    return `javascript: URL in "${attribute}"`;
  }
  return null;
}

// An existing <script> or <base> can be made to run JavaScript by changes that
// are harmless anywhere else: drop the `type` of a JSON-LD <script> and set its
// text, or point a <base> at another host. This only catches a selector that
// names the tag; knowing what a selector matches takes the page itself.
const targetsScriptOrBase = (selector: string) =>
  /(^|[\s>+~,(|])(script|base)(?![\w-])/i.test(
    selector.replace(/\[[^\]]*\]/g, ""),
  );

function mutationProblem(
  mutation: VisualChange["domMutations"][number],
): string | null {
  if (targetsScriptOrBase(mutation.selector)) {
    return `selector "${mutation.selector}" that targets a <script> or <base> element`;
  }
  const problem = mutationValueProblem(mutation);
  return problem && `${problem} in the mutation for "${mutation.selector}"`;
}

type CheckedChange = Partial<
  Pick<VisualChange, "id" | "variation" | "css" | "domMutations">
>;

// What decides whether a mutation runs JavaScript and where, so a change that
// round-trips untouched compares equal whatever else differs.
const checkedFields = ({ css, domMutations }: CheckedChange) =>
  JSON.stringify([
    css || "",
    (domMutations ?? []).map((m) => [
      m.selector,
      m.action,
      m.attribute,
      m.value ?? "",
    ]),
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
