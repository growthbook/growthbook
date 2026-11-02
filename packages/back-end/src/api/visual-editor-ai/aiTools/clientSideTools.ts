import { tool as aiTool } from "ai";
import { z } from "zod";
import {
  PREVIEW_SCREENSHOT_TOOL,
  SCREENSHOTS_PER_TURN_MAX,
} from "back-end/src/api/visual-editor-ai/screenshots";
import {
  makeScopeToken,
  normalizeInsertPlacement,
  wrapWithScope,
} from "back-end/src/api/visual-editor-ai/insertPrimitive";
import type { ClientJob } from "./clientJob";

// DOM-side tools answered by the extension (keep in sync with runAIClientTool): job-based on self-hosted, deferred on Cloud.

const COMPUTED_STYLES_PROPS = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "color",
  "text-align",
  "display",
  "padding",
  "margin",
  "width",
  "max-width",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "border",
  "border-radius",
  "box-shadow",
  "object-fit",
];

const getComputedStylesDef = {
  description:
    'Fetch the computed CSS for an element currently on the page. Returns a record of CSS property → resolved value (e.g. color: "rgb(0, 0, 0)", border-radius: "8px"). Call when the user asks you to match, mimic, or measure against an element that is NOT in elementContext — e.g. "match the homepage hero h1", "make this the same size as the header buttons". Pick the selector from the page elements catalog. If no such selector exists, ask the user to pick the element instead — don\'t guess a selector.',
  inputSchema: z.object({
    selector: z
      .string()
      .min(1)
      .max(500)
      .describe(
        "CSS selector for the element on the live page. Must be present in the page-elements catalog or elementContext. Returns an error result if no element matches.",
      ),
  }),
};

const findElementsDef = {
  description:
    "Find elements on the page that match a CSS selector or a structural pattern. Returns up to 20 matches with their selector, tag, and a short text snippet. Useful for \"find all the testimonial cards\", or when the catalog doesn't list the kind of elements you need to operate on. CSS only — it can't match by text, and XPath / JS predicates aren't supported.",
  inputSchema: z.object({
    selector: z
      .string()
      .min(1)
      .max(500)
      .describe(
        "Valid CSS selector to evaluate against document.querySelectorAll. Examples: '.testimonial-card', 'button[type=submit]', 'section[data-section=\"pricing\"] h3'.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum number of matches to return. Default 10."),
  }),
};

export const SEARCH_PAGE_TOOL = "searchPage";

// The live-page counterpart of grep; the extension runs it (content_script/searchPage.ts).
const searchPageDef = {
  description:
    'Search the live page, like grep. Finds elements whose visible text (or alt, aria-label, title, placeholder) contains `text`, elements matching a CSS `selector`, or elements matching `selector` whose text contains `text`. Text matching is case-insensitive, ignores extra whitespace, and returns the innermost element holding the text. Each match has a `selector` and `parentSelector` to use verbatim, its tag, a text snippet, the start of its outerHTML, and whether it is visible. Use it to find anything the page-elements catalog doesn\'t list — a paragraph, a price, a card by its title — instead of guessing a selector or asking the user to click. For links and images use attribute selectors, e.g. a[href*="pricing"], img[src*="hero"].',
  inputSchema: z.object({
    text: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Words to find, e.g. 'Start free trial' or '$49'."),
    selector: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe(
        "CSS selector the matches must match, e.g. 'button', '.card h3'. Pass `text`, `selector`, or both.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum number of matches to return. Default 10."),
  }),
};

export const INSPECT_LAYOUT_TOOL = "inspectLayout";

const inspectLayoutDef = {
  description:
    "Measure where an element sits on the live page. Returns the viewport (width, height, scroll position, document size) and, with a `selector`, the first match's box in page coordinates, whether it is in the viewport and above the fold, display, position, z-index, overflow, whether it scrolls, the ancestor clipping it if any, visibility, child count and parent selector. Use it to check placement before moving or resizing something, to find what's above the fold, or to work out why an element is hidden or cut off. Omit `selector` for just the viewport. The viewport is narrower than a normal desktop because the editor's side panel is open.",
  inputSchema: z.object({
    selector: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe("CSS selector of the element to measure."),
  }),
};

export const GET_CSS_RULES_TOOL = "getCSSRules";

const getCSSRulesDef = {
  description:
    "List the CSS rules that apply to an element on the live page: each matching rule's selector, its source (stylesheet URL, inline <style>, or the variation's own CSS), the @media it sits in, and its declarations, in stylesheet order, plus the element's inline style. Pass `property` to keep only rules that set it, and to get its computed value. Use it to find where a style comes from before overriding it — e.g. which selector to out-specify, or whether a value comes from a media query. Cross-origin stylesheets can't be read; `unreadableSheets` counts them.",
  inputSchema: z.object({
    selector: z
      .string()
      .min(1)
      .max(500)
      .describe("CSS selector of the element; the first match is used."),
    property: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe("A CSS property such as 'color' or 'padding-top'."),
  }),
};

// Extension tools that read the live page, each offered only when the extension announces it.
export const PAGE_TOOLS = [
  SEARCH_PAGE_TOOL,
  INSPECT_LAYOUT_TOOL,
  GET_CSS_RULES_TOOL,
] as const;
export type PageTool = (typeof PAGE_TOOLS)[number];

const getInnerHTMLDef = {
  description:
    'Fetch the innerHTML of an element on the page. Capped at 4KB; truncated content is flagged. Use when you need to see the actual markup of a section before redesigning it — e.g. "restructure this section to look like the FAQ section" requires reading the FAQ markup. Don\'t use for elements already in elementContext, which carry outerHTML.',
  inputSchema: z.object({
    selector: z.string().min(1).max(500),
  }),
};

// Stateless loop only: the image comes back in `resume.images` (see screenshots.ts).
const previewScreenshotDef = {
  description: `Render your DRAFT on the live page and see a screenshot of it. The draft is applied on top of the variation's current changes, captured, then removed (nothing is saved). Pass the same mutations / cssAppend / insert you plan to return, or none of them to see the page as it is now.
When to call it — decide from your draft, not from how hard the request sounds:
- Only text, link, alt or other attribute changes: don't, unless the new text is much longer than the old and could wrap or overflow.
- Layout, CSS, moves, inserts or images: once, after drafting.
- Again only to check a fix for a problem a screenshot showed. An identical draft is refused.
At most ${SCREENSHOTS_PER_TURN_MAX} per request. The shot shows only the visible window: a \`selector\` crops to that element (scrolled into view), and \`truncated: true\` means it is larger than the window. \`viewport\` is the page width it was taken at, narrower than a normal desktop because the editor's side panel is open. \`unmatchedSelectors\` lists draft selectors that matched nothing, so those changes are missing from the shot — fix the selector rather than re-checking.`,
  inputSchema: z.object({
    selector: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe(
        "Element to crop the screenshot to — usually the one you changed or its section. Omit for the whole visible window.",
      ),
    mutations: z
      .array(
        z.object({
          selector: z.string().min(1).max(500),
          action: z.enum(["set", "append", "remove"]),
          attribute: z.string().min(1).max(100),
          value: z.string().max(50000).optional(),
          parentSelector: z.string().max(500).optional(),
          insertBeforeSelector: z.string().max(500).optional(),
        }),
      )
      .max(50)
      .optional()
      .describe("Draft DOM mutations, same shape as the final output."),
    cssAppend: z
      .string()
      .max(50000)
      .optional()
      .describe("Draft global CSS to add after the variation's existing CSS."),
    insert: z
      .array(
        z.object({
          targetSelector: z.string().min(1).max(500),
          position: z.enum([
            "beforebegin",
            "afterbegin",
            "beforeend",
            "afterend",
          ]),
          html: z.string().min(1).max(50000),
        }),
      )
      .max(10)
      .optional()
      .describe("Draft inserted elements, same shape as the final output."),
  }),
};

export function getComputedStylesTool(job: ClientJob<unknown>) {
  return aiTool({
    ...getComputedStylesDef,
    execute: async ({ selector }) => {
      return await job.requestFromClient("getComputedStyles", {
        selector,
        properties: COMPUTED_STYLES_PROPS,
      });
    },
  });
}

export function findElementsTool(job: ClientJob<unknown>) {
  return aiTool({
    ...findElementsDef,
    execute: async ({ selector, limit }) => {
      return await job.requestFromClient("findElements", { selector, limit });
    },
  });
}

export function getInnerHTMLTool(job: ClientJob<unknown>) {
  return aiTool({
    ...getInnerHTMLDef,
    execute: async ({ selector }) => {
      return await job.requestFromClient("getInnerHTML", { selector });
    },
  });
}

export function deferredDomTools() {
  return {
    getComputedStyles: aiTool(getComputedStylesDef),
    getInnerHTML: aiTool(getInnerHTMLDef),
    findElements: aiTool(findElementsDef),
    searchPage: aiTool(searchPageDef),
    inspectLayout: aiTool(inspectLayoutDef),
    getCSSRules: aiTool(getCSSRulesDef),
    previewScreenshot: aiTool(previewScreenshotDef),
  };
}

// The draft as the extension applies it, built like the final answer so a
// preview lands where the saved change will.
function previewScreenshotArgs(input: unknown) {
  const parsed = previewScreenshotDef.inputSchema.safeParse(input);
  if (!parsed.success) return input;
  const { selector, mutations = [], cssAppend, insert = [] } = parsed.data;
  const hasDraft =
    mutations.length > 0 || !!cssAppend?.trim() || insert.length > 0;
  return {
    selector: selector ?? null,
    draft: hasDraft
      ? {
          mutations: mutations.map((m) =>
            m.attribute === "text" ? { ...m, attribute: "html" } : m,
          ),
          css: cssAppend?.trim() || undefined,
          inserts: insert.map((ins) => {
            const scopeToken = makeScopeToken();
            return {
              ...normalizeInsertPlacement(ins.targetSelector, ins.position),
              html: wrapWithScope(ins.html, scopeToken),
              scopeToken,
            };
          }),
        }
      : null,
  };
}

// The deferred flavour has no execute(), so the property list goes in the args.
export function clientToolArgs(toolName: string, input: unknown): unknown {
  if (toolName === PREVIEW_SCREENSHOT_TOOL) return previewScreenshotArgs(input);
  if (
    toolName === "getComputedStyles" &&
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    return { ...input, properties: COMPUTED_STYLES_PROPS };
  }
  return input;
}
