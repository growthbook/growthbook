import { tool as aiTool } from "ai";
import { z } from "zod";
import {
  describeContainer,
  type PageStructureNode,
} from "back-end/src/api/visual-editor-ai/pageStructure";

export type { PageStructureNode };

const findInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Case-insensitive substring matched against each container\'s visible text label, class names, id, tag, and selector. Examples: "Trusted by", "tab-her-wrap", "pricing", "testimonials".',
    ),
  limit: z.number().int().min(1).max(25).optional(),
});

// Server-side element finder over the in-request page-structure snapshot.
// Unlike the client-bounced DOM tools (which can't resume reliably on Cloud),
// this reads data already in the request, so it runs in a single generation
// pass on Cloud too. It lets the model locate containers that the curated
// page-elements catalog never lists (sections, layout wrappers) — e.g. to
// move or reorder a whole section.
export function findElementsServerTool(nodes: PageStructureNode[]) {
  return aiTool({
    description:
      "Find a page container/section that is NOT in the page-elements catalog. The catalog only lists headings, buttons, links, inputs, images, and top-level landmarks — it does NOT list <section>s or layout wrapper <div>s. Use this to locate such a container by its visible text or class name (e.g. to move/reorder a whole section). Each match returns a durable `selector` (use it verbatim), its `parentSelector` (the destination parent for a sibling move), and the visible siblings around it as `prevSiblingSelector` / `nextSiblingSelector` (the insert-before targets for moving it up or down). If it returns no matches, ask the user to click the element so its selector can be captured.",
    inputSchema: findInputSchema,
    execute: async ({ query, limit }: { query: string; limit?: number }) => {
      const q = query.trim().toLowerCase();
      const cap = limit ?? 10;
      const matches = nodes
        .filter((n) => {
          const haystack = [
            n.label ?? "",
            n.id ?? "",
            n.tag,
            n.selector,
            ...(n.classes ?? []),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        })
        .slice(0, cap)
        .map((n) => ({
          selector: n.selector,
          parentSelector: n.parentSelector,
          prevSiblingSelector: n.prevSiblingSelector,
          nextSiblingSelector: n.nextSiblingSelector,
          tag: n.tag,
          label: n.label,
          classes: n.classes,
          role: n.role,
        }));

      if (matches.length === 0) {
        return {
          ok: true,
          count: 0,
          matches: [],
          note: "No container matched that query. Try a different word from the section's visible text or class name; if still nothing, ask the user to click the element on the page so its selector can be captured.",
        } as const;
      }
      return { ok: true, count: matches.length, matches } as const;
    },
  });
}

const describeInputSchema = z.object({
  selector: z
    .string()
    .min(1)
    .describe(
      "A container selector copied verbatim from the Page outline or a findElements match.",
    ),
});

export function describeContainerServerTool(nodes: PageStructureNode[]) {
  return aiTool({
    description:
      "Describe one container from the Page outline or a findElements match: its `parentSelector`, the visible sibling immediately BEFORE it (`prevSiblingSelector`) and AFTER it (`nextSiblingSelector`), and its direct child containers in page order. This is how to build a position move — to move X up one place: parentSelector = X's parentSelector, insertBeforeSelector = X's prevSiblingSelector; to move X above Y: insertBeforeSelector = Y's selector; to move X after Y: insertBeforeSelector = Y's nextSiblingSelector (null appends). Returns ok:false when the selector isn't a captured container.",
    inputSchema: describeInputSchema,
    execute: async ({ selector }: { selector: string }) => {
      const described = describeContainer(nodes, selector.trim());
      if (!described) {
        return {
          ok: false,
          note: "That selector isn't a captured container. Copy one verbatim from the Page outline or a findElements match.",
        } as const;
      }
      return { ok: true, ...described } as const;
    },
  });
}
