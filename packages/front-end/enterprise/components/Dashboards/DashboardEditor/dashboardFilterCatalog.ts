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
 * Every key is an experiment filter category; they all persist into the single
 * `experimentSearchString`, Project included.
 *
 * A block's own `metricId` is not here: it selects the metric Scaled Impact /
 * Experiments with Lift calculate on, not which experiments they show. The
 * `exp:metric` pill below is the filter — it narrows the list to experiments
 * that analyzed the chosen metric.
 */
export type DashboardOptionalFilterKey =
  `exp:${DashboardExperimentCategoryKey}`;

// Which applicability flag gates a filter: a filter can only be added when a
// block on the dashboard actually honors it.
type FilterRequirement = "experimentSearchString";

export const EXPERIMENT_CATEGORY_LABELS: Record<
  DashboardExperimentCategoryKey,
  string
> = {
  project: "Projects",
  // "Includes metric", not "Metric": this narrows the list to experiments that
  // analyzed the chosen metric. It does not change the metric a block
  // calculates on (Scaled Impact / Experiments with Lift each pick their own).
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
  project: "Search projects...",
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
  // Projects first, keeping the position the old standalone control had.
  project: 0,
  metric: 1,
  owner: 2,
  is: 3,
  tag: 4,
  has: 5,
  status: 6,
};

// Bar and "Add filter" menu order.
export const DASHBOARD_OPTIONAL_FILTERS: {
  key: DashboardOptionalFilterKey;
  label: string;
  requires: FilterRequirement;
}[] = [
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

/** The experiment filter category behind an `exp:*` key. */
export function getExperimentCategory(
  key: DashboardOptionalFilterKey,
): DashboardExperimentCategoryKey {
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
  return (
    getExperimentCategoryValues(
      globalControls?.experimentSearchString,
      getExperimentCategory(key),
    ).length > 0
  );
}
