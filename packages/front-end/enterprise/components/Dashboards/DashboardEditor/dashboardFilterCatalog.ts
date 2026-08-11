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
  metric: "Metric",
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
  // Offered in the "Add filter" menu. A filter that isn't still gets a pill when
  // the dashboard has a saved value, so the value stays visible and removable.
  addable: boolean;
}[] = [
  {
    key: "projects",
    label: "Projects",
    requires: "projects",
    addable: true,
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
      addable: true,
    })),
  {
    // Retired from the menu: the experiment Metric filter above covers picking a
    // metric, so offering both read as duplicates.
    key: "metricId",
    label: "Metric",
    requires: "metricId",
    addable: false,
  },
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
