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
 * `projects` is its own global control; the `exp:*` keys are the experiment
 * filter categories, which all persist into the single `experimentSearchString`.
 */
export type DashboardOptionalFilterKey =
  | "projects"
  | `exp:${DashboardExperimentCategoryKey}`;

// Which applicability flag gates a filter: a filter can only be added when a
// block on the dashboard actually honors it.
type FilterRequirement = "projects" | "experimentSearchString";

export const EXPERIMENT_CATEGORY_LABELS: Record<
  DashboardExperimentCategoryKey,
  string
> = {
  // Not "Metric" — this narrows to experiments that analyzed the metric; it does
  // not change what a block calculates.
  metric: "Includes metric",
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

// Menu order for the experiment filter categories, independent of the order the
// search-string parser declares them in. A Record so a new category can't be
// left out of the menu silently.
const EXPERIMENT_CATEGORY_MENU_ORDER: Record<
  DashboardExperimentCategoryKey,
  number
> = {
  metric: 0,
  owner: 1,
  is: 2,
  tag: 3,
  has: 4,
  status: 5,
};

// Bar and "Add filter" menu order.
export const DASHBOARD_OPTIONAL_FILTERS: {
  key: DashboardOptionalFilterKey;
  label: string;
  requires: FilterRequirement;
}[] = [
  {
    key: "projects",
    label: "Projects",
    requires: "projects",
  },
  ...[...DASHBOARD_EXPERIMENT_CATEGORY_KEYS]
    .sort(
      (a, b) =>
        EXPERIMENT_CATEGORY_MENU_ORDER[a] - EXPERIMENT_CATEGORY_MENU_ORDER[b],
    )
    .map((category) => ({
      key: `exp:${category}` as DashboardOptionalFilterKey,
      label: EXPERIMENT_CATEGORY_LABELS[category],
      requires: "experimentSearchString" as FilterRequirement,
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
  // An empty array is an active "All Projects" override; only an absent value
  // means the filter is unset.
  return Array.isArray(globalControls?.projects);
}
