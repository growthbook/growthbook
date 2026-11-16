import { z } from "zod";

// One container in the page's structural snapshot (sections, layout
// wrappers, ancestors of catalog headings), captured client-side with a
// durable selector precomputed per node. Backs the page outline and the
// server-side `findElements` / `describeContainer` tools.
export const structureNodeSchema = z.object({
  selector: z.string(),
  // The direct parent element — the destination of a sibling move.
  parentSelector: z.string().optional(),
  tag: z.string(),
  id: z.string().optional(),
  classes: z.array(z.string()).optional(),
  role: z.string().optional(),
  // Short trimmed text label for matching by visible content.
  label: z.string().optional(),
  // Newer extensions only; the siblings are the nearest visible ones.
  docOrder: z.number().int().nonnegative().optional(),
  prevSiblingSelector: z.string().optional(),
  nextSiblingSelector: z.string().optional(),
  layout: z.enum(["flex-row", "flex-column", "grid"]).optional(),
});

const layoutSchema = z.enum(["flex-row", "flex-column", "grid"]).optional();

// Compact element catalog from visual-editor/src/content_script/pageDigest.ts —
// gives the LLM real selectors to pick from rather than guessing.
export const domDigestSchema = z.object({
  url: z.string(),
  title: z.string(),
  // Page-structure entries (html, body, header, main, etc.) — always-valid
  // targets for global styling requests.
  structural: z
    .array(
      z.object({
        selector: z.string(),
        tag: z.string(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  // `sectionSelector` (newer extensions): the enclosing snapshot container.
  headings: z
    .array(
      z.object({
        selector: z.string(),
        tag: z.string(),
        text: z.string(),
        sectionSelector: z.string().optional(),
      }),
    )
    .default([]),
  // `parentLayout` (newer extensions) lets an insert below a row anchor to the row.
  buttons: z
    .array(
      z.object({
        selector: z.string(),
        tag: z.string(),
        text: z.string(),
        href: z.string().optional(),
        sectionSelector: z.string().optional(),
        parentSelector: z.string().optional(),
        parentLayout: layoutSchema,
      }),
    )
    .default([]),
  links: z
    .array(
      z.object({
        selector: z.string(),
        text: z.string(),
        href: z.string(),
        sectionSelector: z.string().optional(),
        parentSelector: z.string().optional(),
        parentLayout: layoutSchema,
      }),
    )
    .default([]),
  inputs: z
    .array(
      z.object({
        selector: z.string(),
        type: z.string(),
        name: z.string().optional(),
        placeholder: z.string().optional(),
        label: z.string().optional(),
        sectionSelector: z.string().optional(),
      }),
    )
    .default([]),
  images: z
    .array(
      z.object({
        selector: z.string(),
        alt: z.string().optional(),
        src: z.string(),
        sectionSelector: z.string().optional(),
        parentSelector: z.string().optional(),
        parentLayout: layoutSchema,
      }),
    )
    .default([]),
  // Rendered as the page outline when it carries document order.
  pageStructure: z.array(structureNodeSchema).max(400).optional(),
  // Flat alternative to the typed arrays above; both may be populated.
  elements: z
    .array(
      z.object({
        selector: z.string(),
        tag: z.string(),
        text: z.string().optional(),
        href: z.string().optional(),
        src: z.string().optional(),
        alt: z.string().optional(),
        placeholder: z.string().optional(),
      }),
    )
    .max(300)
    .optional(),
});

export type DomDigest = z.infer<typeof domDigestSchema>;
