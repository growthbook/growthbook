import { z } from "zod";
import type { ReactElement } from "react";

export const storyCategories = [
  { id: "patterns", label: "Patterns" },
  { id: "actions", label: "Actions" },
  { id: "inputs", label: "Inputs" },
  { id: "feedback", label: "Feedback" },
  { id: "overlays", label: "Overlays" },
  { id: "navigation", label: "Navigation" },
  { id: "layout", label: "Layout" },
  { id: "typography", label: "Typography" },
  { id: "data-display", label: "Data Display" },
  { id: "experimentation", label: "Experimentation" },
] as const;

export type StoryCategory = (typeof storyCategories)[number]["id"];

const categoryIds = storyCategories.map((c) => c.id) as [
  StoryCategory,
  ...StoryCategory[],
];

const baseMeta = z.object({
  name: z.string().min(1),
  category: z.enum(categoryIds),
  summary: z.string().min(1),
  useWhen: z.array(z.string().min(1)),
  avoidWhen: z.array(
    z.object({
      reason: z.string().min(1),
      // Name of another story's meta.name to reach for instead.
      use: z.string().min(1).optional(),
    }),
  ),
  related: z.array(z.string().min(1)).optional(),
  // Real files that follow this guidance, relative to packages/front-end.
  examples: z.array(z.string().min(1)).optional(),
});

export const storyMetaSchema = z.discriminatedUnion("status", [
  baseMeta.extend({ status: z.enum(["stable", "beta"]) }),
  baseMeta.extend({
    status: z.enum(["legacy", "deprecated"]),
    replacedBy: z.string().min(1),
  }),
]);

export type StoryMeta = z.infer<typeof storyMetaSchema>;
export type StoryStatus = StoryMeta["status"];

export type StoryModule = {
  default: () => ReactElement | null;
  meta: StoryMeta;
};

/** Cross-references (`use`, `related`, `replacedBy`) that name no known story. */
export function findDanglingReferences(metas: StoryMeta[]): string[] {
  const names = new Set(metas.map((m) => m.name));
  const problems: string[] = [];
  for (const m of metas) {
    const refs = [
      ...m.avoidWhen.flatMap((a) => (a.use ? [a.use] : [])),
      ...(m.related ?? []),
      ...("replacedBy" in m ? [m.replacedBy] : []),
    ];
    for (const ref of refs) {
      if (!names.has(ref)) problems.push(`${m.name} → "${ref}"`);
    }
  }
  return problems;
}

/** Anchor id for a story or category name on the /design-system page. */
export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
