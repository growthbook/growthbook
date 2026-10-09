import { CONFIRM_LABELS } from "shared/validators";

export type Category =
  (typeof CONFIRM_LABELS)[number] extends `${infer C}.${string}` ? C : never;
export const CATEGORY_TITLES: Record<Category, string> = {
  feature: "Feature Flags",
  experiment: "Experiments",
  savedGroup: "Saved Groups",
  constant: "Constants",
  config: "Configs",
  rampSchedule: "Ramp Schedules",
  override: "Overrides",
};
export const CATEGORIES = Object.keys(CATEGORY_TITLES) as Category[];
export const ALL = "*";

export const categoryOf = (value: string) => value.split(".")[0] as Category;
export const isCategory = (value: string) => value.endsWith(".*");
export const isCatchAll = (value: string) => value.endsWith(".other");
export const actionsOf = (category: Category) =>
  CONFIRM_LABELS.filter((label) => categoryOf(label) === category);

// "approveStep" reads as "approve step".
export const verbOf = (label: string) =>
  isCatchAll(label)
    ? "other actions"
    : label
        .split(".")[1]
        .replace(/([A-Z])/g, " $1")
        .toLowerCase();

// Clicking a row checked only through a wildcard unchecks just that row: the
// wildcard gives way to its other members. Checking every member of a category,
// or every category, folds back into the wildcard.
export function toggleAction(value: string[], clicked: string): string[] {
  const selected = new Set(value);
  if (clicked !== ALL && selected.has(ALL)) {
    selected.delete(ALL);
    CATEGORIES.forEach((category) => selected.add(`${category}.*`));
  }
  const category = clicked === ALL ? null : categoryOf(clicked);
  if (category && !isCategory(clicked) && selected.has(`${category}.*`)) {
    selected.delete(`${category}.*`);
    actionsOf(category).forEach((label) => selected.add(label));
  }

  if (selected.has(clicked)) selected.delete(clicked);
  else if (clicked === ALL) return [ALL];
  else {
    selected.add(clicked);
    if (category && isCategory(clicked)) {
      actionsOf(category).forEach((label) => selected.delete(label));
    }
  }

  for (const c of CATEGORIES) {
    if (actionsOf(c).every((label) => selected.has(label))) {
      actionsOf(c).forEach((label) => selected.delete(label));
      selected.add(`${c}.*`);
    }
  }
  if (CATEGORIES.every((c) => selected.has(`${c}.*`))) return [ALL];
  return [
    ALL,
    ...CATEGORIES.flatMap((c) => [`${c}.*`, ...actionsOf(c)]),
  ].filter((v) => selected.has(v));
}

// "Feature Flags (publish, archive) in production; Overrides (skip hooks)"
export function describeActions(
  actions: { action: string; environments: string[] }[],
): string {
  return CATEGORIES.flatMap((category) => {
    const mine = actions.filter((a) => categoryOf(a.action) === category);
    if (!mine.length) return [];
    const envs = [...new Set(mine.flatMap((a) => a.environments))];
    return [
      `${CATEGORY_TITLES[category]} (${mine.map((a) => verbOf(a.action)).join(", ")})${
        envs.length ? ` in ${envs.join(", ")}` : ""
      }`,
    ];
  }).join("; ");
}
