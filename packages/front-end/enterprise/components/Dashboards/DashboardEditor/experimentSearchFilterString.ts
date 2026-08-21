import { EXPERIMENT_FILTER_KEYS } from "@/components/Search/SidebarExperimentFilters";
import { filterToString } from "@/components/Search/SearchFilters";
import { SyntaxFilter, transformQuery } from "@/services/search";

/**
 * Read/write helpers for the dashboard's global `experimentSearchString`.
 *
 * The dashboard filter bar surfaces one pill per experiment filter category
 * (Metrics filter, Result, Owner, …), but they all persist into the single
 * `experimentSearchString` as `field:value` syntax filters — the same format
 * SidebarExperimentFilters and the backend search already understand.
 *
 * Only plain filters (`field:value`) are authored here. Negated (`field:!x`) or
 * operator (`field:>x`) filters and the free-text search term can only arrive
 * from hand-typed strings or the API; they are read separately and always
 * preserved when a category is edited.
 */

// Experiment filter categories the dashboard bar exposes as their own pill.
// `project` is intentionally absent: the dashboard has a dedicated Projects
// filter, so offering the experiment-search Project category too would apply
// the same restriction twice.
export const DASHBOARD_EXPERIMENT_CATEGORY_KEYS = [
  "metric",
  "is",
  "owner",
  "status",
  "tag",
  "has",
] as const;

export type DashboardExperimentCategoryKey =
  (typeof DASHBOARD_EXPERIMENT_CATEGORY_KEYS)[number];

const isPlainFilter = (filter: SyntaxFilter) =>
  !filter.negated && !filter.operator;

function parse(searchString: string | undefined) {
  return transformQuery(searchString ?? "", EXPERIMENT_FILTER_KEYS);
}

// Reassemble a search string from syntax filter tokens plus the free-text term.
function serialize(filters: SyntaxFilter[], searchTerm: string): string {
  return [...filters.map(filterToString), searchTerm.trim()]
    .filter(Boolean)
    .join(" ");
}

/** The values currently selected for one category (empty when inactive). */
export function getExperimentCategoryValues(
  searchString: string | undefined,
  field: DashboardExperimentCategoryKey,
): string[] {
  const { syntaxFilters } = parse(searchString);
  return (
    syntaxFilters.find((f) => isPlainFilter(f) && f.field === field)?.values ??
    []
  );
}

/**
 * Replace one category's values, leaving every other category, any advanced
 * (negated/operator) filter, and the free-text term untouched. Passing an empty
 * array clears the category.
 */
export function setExperimentCategoryValues(
  searchString: string | undefined,
  field: DashboardExperimentCategoryKey,
  values: string[],
): string {
  const { searchTerm, syntaxFilters } = parse(searchString);
  const kept = syntaxFilters.filter(
    (f) => !(isPlainFilter(f) && f.field === field),
  );
  if (values.length > 0) {
    kept.push({ field, values, operator: "", negated: false });
  }
  return serialize(kept, searchTerm);
}

/** The free-text portion of the search string (no `field:value` tokens). */
export function getExperimentSearchTerm(
  searchString: string | undefined,
): string {
  return parse(searchString).searchTerm;
}

/** Replace the free-text portion, keeping every `field:value` token. */
export function setExperimentSearchTerm(
  searchString: string | undefined,
  searchTerm: string,
): string {
  const { syntaxFilters } = parse(searchString);
  return serialize(syntaxFilters, searchTerm);
}

/**
 * Advanced filters the pill UI can't author (negated or operator filters typed
 * by hand or set through the API). Surfaced so the bar can tell the user the
 * search string still carries filters it isn't showing.
 */
export function getAdvancedExperimentFilters(
  searchString: string | undefined,
): SyntaxFilter[] {
  return parse(searchString).syntaxFilters.filter((f) => !isPlainFilter(f));
}
