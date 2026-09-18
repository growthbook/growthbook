import { z } from "zod";

// Compact element catalog from visual-editor/src/content_script/pageDigest.ts.
// pageStructure is carried in the request but never rendered into the prompt —
// findElements reads it on demand.

export const structureNodeSchema = z.object({
  selector: z.string(),
  parentSelector: z.string().optional(),
  tag: z.string(),
  id: z.string().optional(),
  classes: z.array(z.string()).optional(),
  role: z.string().optional(),
  label: z.string().optional(),
});

export const domDigestSchema = z.object({
  url: z.string(),
  title: z.string(),
  structural: z
    .array(
      z.object({
        selector: z.string(),
        tag: z.string(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  headings: z
    .array(
      z.object({
        selector: z.string(),
        tag: z.string(),
        text: z.string(),
      }),
    )
    .default([]),
  buttons: z
    .array(
      z.object({
        selector: z.string(),
        tag: z.string(),
        text: z.string(),
        href: z.string().optional(),
      }),
    )
    .default([]),
  links: z
    .array(
      z.object({
        selector: z.string(),
        text: z.string(),
        href: z.string(),
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
      }),
    )
    .default([]),
  images: z
    .array(
      z.object({
        selector: z.string(),
        alt: z.string().optional(),
        src: z.string(),
      }),
    )
    .default([]),
  pageStructure: z.array(structureNodeSchema).max(400).optional(),
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

export type PageStructureNode = z.infer<typeof structureNodeSchema>;
export type DomDigest = z.infer<typeof domDigestSchema>;
