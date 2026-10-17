import { z } from "zod";
import { ExperimentInterface } from "shared/types/experiment";

// Built-in pre-launch checklist items an org or project checklist can hide
export const builtInChecklistItemKeyValidator = z.enum([
  "datasource",
  "exposureQuery",
  "goalMetric",
  "linkedChanges",
  "targeting",
  "sdkConnection",
]);

export type BuiltInChecklistItemKey = z.infer<
  typeof builtInChecklistItemKeyValidator
>;

export const BUILT_IN_CHECKLIST_ITEM_LABELS: Record<
  BuiltInChecklistItemKey,
  string
> = {
  datasource: "Select a Data Source",
  exposureQuery: "Select an experiment assignment table",
  goalMetric: "Add at least one goal metric",
  linkedChanges:
    "Add a linked Feature Flag, Visual Editor change, or URL redirect",
  targeting: "Configure variation assignment and targeting",
  sdkConnection: "Add an SDK Connection",
};

export function getHiddenBuiltInChecklistItems(
  checklist:
    | { hiddenBuiltInItems?: BuiltInChecklistItemKey[] }
    | null
    | undefined,
  exp: Pick<
    ExperimentInterface,
    "type" | "hasVisualChangesets" | "hasURLRedirects"
  >,
): Set<BuiltInChecklistItemKey> {
  // Bandits can't run without their built-ins (a live linked change and a goal metric)
  if (exp.type === "multi-armed-bandit") return new Set();
  const hidden = new Set(checklist?.hiddenBuiltInItems ?? []);
  // Visual Editor changes and URL Redirects only reach users through an SDK Connection
  if (exp.hasVisualChangesets || exp.hasURLRedirects) {
    hidden.delete("sdkConnection");
  }
  return hidden;
}
