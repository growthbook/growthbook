import { tool as aiTool } from "ai";
import { z } from "zod";
import {
  describeContainer,
  type PageStructureNode,
} from "back-end/src/api/visual-editor-ai/pageStructure";

export type { PageStructureNode };

// One per request, shared by both lookup tools: a model that re-asks the same
// question is told so, instead of getting the same answer as if it were new.
export type LookupMemo = Map<string, number>;

const repeatNote = (times: number): string =>
  `You have asked exactly this ${times} times and the answer has not changed. Stop looking: act on what you already have (for a reorder whose shared parent is unknown, one CSS \`order\` rule per item), or list the part in \`skipped\` and ask the user to click the element.`;

const countRepeat = (memo: LookupMemo | undefined, key: string): number => {
  if (!memo) return 1;
  const n = (memo.get(key) ?? 0) + 1;
  memo.set(key, n);
  return n;
};

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
export function findElementsServerTool(
  nodes: PageStructureNode[],
  memo?: LookupMemo,
) {
  const captured = new Set(nodes.map((n) => n.selector));
  return aiTool({
    description:
      "Find a page container/section that is NOT in the page-elements catalog. The catalog only lists headings, buttons, links, inputs, images, and top-level landmarks — it does NOT list <section>s or layout wrapper <div>s. Use this to locate such a container by its visible text or class name (e.g. to move/reorder a whole section, or a card/plan by its title). Each match returns a durable `selector` (use it verbatim), its `parentSelector` (the destination parent for a sibling move — pass it to describeContainer to list ALL the siblings in page order) with `parentCaptured` saying whether that parent is itself a known container, and the visible siblings around it as `prevSiblingSelector` / `nextSiblingSelector` (the insert-before targets for moving it up or down). If it returns no matches, ask the user to click the element so its selector can be captured.",
    inputSchema: findInputSchema,
    execute: async ({ query, limit }: { query: string; limit?: number }) => {
      const q = query.trim().toLowerCase();
      const cap = limit ?? 10;
      const times = countRepeat(memo, `find:${q}`);
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
          parentCaptured: !!n.parentSelector && captured.has(n.parentSelector),
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
          note:
            times > 1
              ? repeatNote(times)
              : "No container matched that query. Try a different word from the section's visible text or class name; if still nothing, ask the user to click the element on the page so its selector can be captured.",
        } as const;
      }
      const notes: string[] = [];
      if (times > 1) notes.push(repeatNote(times));
      if (matches.some((m) => m.parentSelector && !m.parentCaptured)) {
        notes.push(
          "Some parentSelectors are not captured containers: describeContainer on them lists only what is known, and a position move into them cannot be verified. To reorder such siblings, emit one CSS `order` rule per item selector instead of hunting for the parent.",
        );
      }
      return {
        ok: true,
        count: matches.length,
        matches,
        ...(notes.length ? { note: notes.join(" ") } : {}),
      } as const;
    },
  });
}

const describeInputSchema = z.object({
  selector: z
    .string()
    .min(1)
    .describe(
      "A container selector copied verbatim from the Page outline or a findElements match — either a match's `selector` or its `parentSelector`.",
    ),
});

export function describeContainerServerTool(
  nodes: PageStructureNode[],
  memo?: LookupMemo,
) {
  return aiTool({
    description:
      "Describe one container from the Page outline or a findElements match: its `parentSelector`, the visible sibling immediately BEFORE it (`prevSiblingSelector`) and AFTER it (`nextSiblingSelector`), and its direct child containers in page order. Passing a match's `parentSelector` lists every sibling in order — one call is enough to plan a reorder of several items. This is how to build a position move — to move X up one place: parentSelector = X's parentSelector, insertBeforeSelector = X's prevSiblingSelector; to move X above Y: insertBeforeSelector = Y's selector; to move X after Y: insertBeforeSelector = Y's nextSiblingSelector (null appends). For a selector that was never captured it lists the known containers inside it as `descendants`; returns ok:false when nothing at all is known.",
    inputSchema: describeInputSchema,
    execute: async ({ selector }: { selector: string }) => {
      const s = selector.trim();
      const times = countRepeat(memo, `describe:${s}`);
      const described = describeContainer(nodes, s);
      if (!described) {
        return {
          ok: false,
          note:
            times > 1
              ? repeatNote(times)
              : "Nothing is known about that selector. Copy one verbatim from the Page outline or a findElements match (its selector or parentSelector).",
        } as const;
      }
      return {
        ok: true,
        ...described,
        ...(times > 1
          ? {
              note: [described.note, repeatNote(times)]
                .filter(Boolean)
                .join(" "),
            }
          : {}),
      } as const;
    },
  });
}
