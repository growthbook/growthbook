import {
  CONFIRM_ACTIONS,
  RECOMMENDED_CONFIRM_ACTIONS,
  type ConfirmAction,
  type ConfirmRule,
} from "shared/validators";
import { actionCovers } from "shared/util";

export type Category = ConfirmAction extends `${infer C}.${string}` ? C : never;
export const CATEGORY_TITLES: Record<Category, string> = {
  feature: "Feature Flags",
  experiment: "Experiments",
  savedGroup: "Saved Groups",
  constant: "Constants",
  config: "Configs",
  rampSchedule: "Ramp Schedules",
  settings: "Settings",
  access: "Members & Teams",
  customHook: "Custom Hooks",
  environment: "Environments",
  project: "Projects",
  attribute: "Attributes",
  customField: "Custom Fields",
  sdkConnection: "SDK Connections",
  metric: "Metrics",
  factTable: "Fact Tables",
  segment: "Segments",
  dimension: "Dimensions",
  override: "Overrides",
  other: "Everything Else",
};
export const SECTIONS: { title: string; categories: Category[] }[] = [
  {
    title: "Releases",
    categories: [
      "feature",
      "experiment",
      "savedGroup",
      "constant",
      "config",
      "rampSchedule",
    ],
  },
  {
    title: "Governance",
    categories: [
      "settings",
      "access",
      "customHook",
      "environment",
      "project",
      "attribute",
      "customField",
      "sdkConnection",
    ],
  },
  {
    title: "Analysis",
    categories: ["metric", "factTable", "segment", "dimension"],
  },
  { title: "Other", categories: ["override", "other"] },
];
export const CATEGORIES = SECTIONS.flatMap((section) => section.categories);
export const ALL = "*";
export const RECOMMENDED = "recommended";

export const categoryOf = (value: string) => value.split(".")[0] as Category;
export const isCategory = (value: string) => value.endsWith(".*");
export const isCatchAll = (value: string) =>
  value.endsWith(".other") || value === "other.write";
export const actionsOf = (category: Category): ConfirmAction[] =>
  CONFIRM_ACTIONS.filter((action) => categoryOf(action) === category);
// A category with one action is picked as a whole, like "Everything Else".
export const isSingleAction = (category: Category) =>
  actionsOf(category).length === 1;

// "ignoreWarnings" reads as "ignore warnings".
export const verbOf = (action: string) => {
  const verb = action.split(".")[1];
  if (verb === "other") return "other actions";
  if (verb === "restBypassesReviews") return "REST bypasses reviews";
  if (verb === "unscopedRules")
    return "allow rules for All Environments and All Projects";
  if (verb === "visualEditor") return "AI Visual Editor";
  if (verb === "checklist") return "launch checklist items";
  return verb.replace(/([A-Z])/g, " $1").toLowerCase();
};

// The actions a rule's picks cover.
const expand = (picks: string[]) =>
  new Set<ConfirmAction>(
    CONFIRM_ACTIONS.filter((action) =>
      picks.some((pick) => actionCovers(pick, action)),
    ),
  );
const within = (actions: readonly ConfirmAction[], set: Set<ConfirmAction>) =>
  actions.every((action) => set.has(action));

// The fewest picks for a set of actions: "*", then "recommended", then a
// category for each one fully picked beyond it, then single actions.
function toPicks(set: Set<ConfirmAction>): string[] {
  if (set.size === CONFIRM_ACTIONS.length) return [ALL];
  const recommended = within(RECOMMENDED_CONFIRM_ACTIONS, set);
  const base = new Set<ConfirmAction>(
    recommended ? RECOMMENDED_CONFIRM_ACTIONS : [],
  );
  return [
    ...(recommended ? [RECOMMENDED] : []),
    ...CATEGORIES.flatMap((category) => {
      const actions = actionsOf(category);
      if (within(actions, base)) return [];
      if (within(actions, set)) return [`${category}.*`];
      return actions.filter((action) => set.has(action) && !base.has(action));
    }),
  ];
}

// Whether a picker row is checked: everything it stands for is picked.
export const isPicked = (picks: string[], row: string) => {
  const set = expand(picks);
  return row === ALL
    ? set.size === CONFIRM_ACTIONS.length
    : within([...expand([row])], set);
};

// The preset a rule list amounts to: one rule, everywhere, picking only it.
export function presetOf(rules: ConfirmRule[]) {
  const [rule, ...rest] = rules;
  if (!rule || rest.length || rule.environments?.length) return null;
  const [pick, ...more] = rule.actions;
  return !more.length && (pick === ALL || pick === RECOMMENDED) ? pick : null;
}

// Some of what a row stands for is picked, but not all of it.
export function isPartlyPicked(picks: string[], row: string) {
  const set = expand(picks);
  const actions = [...expand([row])];
  const picked = actions.filter((action) => set.has(action));
  return picked.length > 0 && picked.length < actions.length;
}

// Clicking a checked row unchecks everything it stands for, so a row checked
// only through a wildcard unchecks just itself. Recommended, clicked under
// All actions, narrows to itself.
export function toggleAction(picks: string[], clicked: string): string[] {
  const set = expand(picks);
  const everything = set.size === CONFIRM_ACTIONS.length;
  if (clicked === ALL) return everything ? [] : [ALL];
  if (clicked === RECOMMENDED && everything) return [RECOMMENDED];
  const actions = [...expand([clicked])];
  const checked = within(actions, set);
  actions.forEach((action) => (checked ? set.delete(action) : set.add(action)));
  return toPicks(set);
}

// Rules for the same environments act as one rule, so they save as one.
export function mergeConfirmRules(rules: ConfirmRule[]): ConfirmRule[] {
  const byEnvironments = new Map<string, ConfirmRule>();
  for (const rule of rules) {
    const key = JSON.stringify([...(rule.environments ?? [])].sort());
    const into = byEnvironments.get(key);
    byEnvironments.set(key, {
      ...(into ?? rule),
      actions: toPicks(expand([...(into?.actions ?? []), ...rule.actions])),
    });
  }
  return [...byEnvironments.values()];
}
