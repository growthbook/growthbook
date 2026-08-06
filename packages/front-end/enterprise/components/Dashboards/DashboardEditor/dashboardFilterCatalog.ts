import { DashboardInterface } from "shared/enterprise";
import {
  DASHBOARD_EXPERIMENT_CATEGORY_KEYS,
  DashboardExperimentCategoryKey,
  getExperimentCategoryValues,
} from "./experimentSearchFilterString";

/**
 * The optional filters the dashboard bar can show. The Date Range control is not
 * in here — it is permanent and always rendered first. Everything else starts
 * hidden and is added from the "Add filter" dropdown (or shown automatically
 * because the dashboard already has a value for it).
 *
 * `projects` and `metricId` are their own global controls; the `exp:*` keys are
 * the experiment filter categories, which all persist into the single
 * `experimentSearchString`.
 */
export type DashboardOptionalFilterKey =
  | "projects"
  | "metricId"
  | `exp:${DashboardExperimentCategoryKey}`;

// Which applicability flag gates a filter: a filter can only be added when a
// block on the dashboard actually honors it.
type FilterRequirement = "projects" | "metricId" | "experimentSearchString";

export const EXPERIMENT_CATEGORY_LABELS: Record<
  DashboardExperimentCategoryKey,
  string
> = {
  // Plural, and grouped under the "Experiment filters" heading in the menu, so it
  // reads apart from the dashboard's own singular Metric filter: this one narrows
  // which experiments are included, not which metric the blocks report on.
  metric: "Metrics",
  is: "Result",
  owner: "Owner",
  status: "Status",
  tag: "Tag",
  has: "Type",
};

export const EXPERIMENT_CATEGORY_SEARCH_PLACEHOLDERS: Record<
  DashboardExperimentCategoryKey,
  string
> = {
  metric: "Search metrics...",
  is: "Search results...",
  owner: "Search owners...",
  status: "Search statuses...",
  tag: "Search tags...",
  has: "Search types...",
};

/**
 * Sections of the "Add filter" menu, rendered in this order and separated by a
 * divider. The dashboard's own filters come first; the experiment filter
 * categories sit under their own heading, which is what keeps "Metrics" (narrow
 * the experiments) legible next to "Metric" (what the blocks report on).
 */
export const DASHBOARD_FILTER_GROUPS = [
  { key: "dashboard", label: "Add a filter" },
  { key: "experiment", label: "Experiment filters" },
] as const;

export type DashboardFilterGroupKey =
  (typeof DASHBOARD_FILTER_GROUPS)[number]["key"];

// Bar and "Add filter" menu order: the dashboard's own filters first, then the
// experiment filter categories.
export const DASHBOARD_OPTIONAL_FILTERS: {
  key: DashboardOptionalFilterKey;
  label: string;
  requires: FilterRequirement;
  group: DashboardFilterGroupKey;
}[] = [
  {
    key: "projects",
    label: "Projects",
    requires: "projects",
    group: "dashboard",
  },
  {
    key: "metricId",
    label: "Metric",
    requires: "metricId",
    group: "dashboard",
  },
  ...DASHBOARD_EXPERIMENT_CATEGORY_KEYS.map((category) => ({
    key: `exp:${category}` as DashboardOptionalFilterKey,
    label: EXPERIMENT_CATEGORY_LABELS[category],
    requires: "experimentSearchString" as FilterRequirement,
    group: "experiment" as DashboardFilterGroupKey,
  })),
];

/** The experiment filter category behind an `exp:*` key, or null for the rest. */
export function getExperimentCategory(
  key: DashboardOptionalFilterKey,
): DashboardExperimentCategoryKey | null {
  if (!key.startsWith("exp:")) return null;
  return key.slice("exp:".length) as DashboardExperimentCategoryKey;
}

/**
 * Whether the dashboard already has a value for this filter. Active filters are
 * always shown, so a saved filter never becomes invisible after a reload.
 */
export function isOptionalFilterActive(
  globalControls: DashboardInterface["globalControls"],
  key: DashboardOptionalFilterKey,
): boolean {
  const category = getExperimentCategory(key);
  if (category) {
    return (
      getExperimentCategoryValues(
        globalControls?.experimentSearchString,
        category,
      ).length > 0
    );
  }
  if (key === "projects") {
    // An empty array is an active "All Projects" override; only an absent value
    // means the filter is unset.
    return Array.isArray(globalControls?.projects);
  }
  return Boolean(globalControls?.metricId);
}
