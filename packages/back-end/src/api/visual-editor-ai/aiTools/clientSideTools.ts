import { tool as aiTool } from "ai";
import { z } from "zod";
import type { ClientJob } from "./clientJob";

// DOM-side tools — the model's execute() calls block on the client
// providing the result via /edit/resume. Each tool here is paired with
// a handler in the extension's content script (computedStyles, find,
// innerHTML) — keep names + arg shapes in sync.

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

export function getComputedStylesTool(job: ClientJob<unknown>) {
  return aiTool({
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
    execute: async ({ selector, limit }) => {
      return await job.requestFromClient("findElements", { selector, limit });
    },
  });
}

export function getInnerHTMLTool(job: ClientJob<unknown>) {
  return aiTool({
    description:
      'Fetch the innerHTML of an element on the page. Capped at 4KB; truncated content is flagged. Use when you need to see the actual markup of a section before redesigning it — e.g. "restructure this section to look like the FAQ section" requires reading the FAQ markup. Don\'t use for elements already in elementContext, which carry outerHTML.',
    inputSchema: z.object({
      selector: z.string().min(1).max(500),
    }),
    execute: async ({ selector }) => {
      return await job.requestFromClient("getInnerHTML", { selector });
    },
  });
}
