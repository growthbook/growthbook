import { tool as aiTool } from "ai";
import { z } from "zod";
import type { PageStructureNode } from "back-end/src/api/visual-editor-ai/domDigest";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Case-insensitive substring matched against each container\'s visible text label, class names, id, tag, and selector. Examples: "Trusted by", "tab-her-wrap", "pricing", "testimonials".',
    ),
  limit: z.number().int().min(1).max(25).optional(),
});

// Server-side finder over the in-request page-structure snapshot. Unlike
// the client-bounced DOM tools, this reads data already in the request, so
// it runs in a single generation pass on Cloud too.
export function findElementsServerTool(nodes: PageStructureNode[]) {
  return aiTool({
    description:
      "Find a page container/section that is NOT in the page-elements catalog. The catalog only lists headings, buttons, links, inputs, images, and top-level landmarks — it does NOT list <section>s or layout wrapper <div>s. Use this to locate such a container by its visible text or class name (e.g. to move/reorder a whole section). Each match returns a durable `selector` (use it verbatim) and its `parentSelector` (the destination parent for a sibling position move). If it returns no matches, ask the user to click the element so its selector can be captured.",
    inputSchema,
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
