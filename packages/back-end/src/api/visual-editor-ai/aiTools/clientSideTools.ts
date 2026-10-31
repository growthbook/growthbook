import { tool as aiTool } from "ai";
import { z } from "zod";
import { SCREENSHOTS_PER_TURN_MAX } from "back-end/src/api/visual-editor-ai/screenshots";
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
    "Find elements on the page that match a CSS selector or a structural pattern. Returns up to 20 matches with their selector, tag, and a short text snippet. Useful for \"find all the testimonial cards\", \"find every button containing 'Sign up'\", or when the catalog doesn't list the kind of elements you need to operate on. Limit the selector to CSS — XPath / JS predicates aren't supported.",
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

const getInnerHTMLDef = {
  description:
    'Fetch the innerHTML of an element on the page. Capped at 4KB; truncated content is flagged. Use when you need to see the actual markup of a section before redesigning it — e.g. "restructure this section to look like the FAQ section" requires reading the FAQ markup. Don\'t use for elements already in elementContext, which carry outerHTML.',
  inputSchema: z.object({
    selector: z.string().min(1).max(500),
  }),
};

// Stateless loop only: the image comes back in `resume.images` (see screenshots.ts).
const previewScreenshotDef = {
  description: `Render your DRAFT on the live page and see a screenshot of it. The extension applies the draft on top of the variation's current changes, screenshots the result, and then removes the draft again (nothing is saved). Pass the same mutations / cssAppend / insert you plan to return. Omit all three to see the page as it is now, e.g. to judge the current design before redesigning it. Use it to check layout, spacing, contrast, overflow, and whether an insert or move landed where you meant — not for plain text swaps. At most ${SCREENSHOTS_PER_TURN_MAX} per request, and each one spends a tool call, so draft first and check once. The shot shows only the visible window: a \`selector\` crops to that element (scrolled into view), and \`truncated: true\` means it is larger than the window. The result's \`viewport\` is the page width the shot was taken at, which is narrower than a normal desktop because the editor's side panel is open.`,
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
    previewScreenshot: aiTool(previewScreenshotDef),
  };
}

// The deferred flavour has no execute(), so the property list goes in the args.
export function clientToolArgs(toolName: string, input: unknown): unknown {
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
