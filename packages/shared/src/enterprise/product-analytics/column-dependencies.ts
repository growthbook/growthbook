import { z } from "zod";
import { RowFilter } from "shared/types/fact-table";
import { SqlIdentifierQuote } from "shared/types/sql";
import {
  dimensionValidator,
  factTableExplorationConfigValidator,
  funnelExplorationConfigValidator,
  metricExplorationConfigValidator,
  dataSourceExplorationConfigValidator,
} from "../../validators/product-analytics";
import { sqlReferencesColumn } from "../../experiments/experiments";

// The exploration config shape persisted by both saved explorations and
// dashboard "exploration" blocks. Only fact_table and funnel configs reference
// fact-table columns; metric configs reference metrics (covered by the fact-
// metric dependency scan) and data_source configs reference raw warehouse
// columns (never fact-table columns).
type ExplorationConfig =
  | z.infer<typeof metricExplorationConfigValidator>
  | z.infer<typeof factTableExplorationConfigValidator>
  | z.infer<typeof dataSourceExplorationConfigValidator>
  | z.infer<typeof funnelExplorationConfigValidator>;

type Dimension = z.infer<typeof dimensionValidator>;

// A saved filter, by id and raw SQL, so `saved_filter` row filters can be
// resolved to the SQL they reference.
type SavedFilter = { id: string; value: string };

// A row filter references `columnName` when it targets the column directly, via
// a raw `sql_expr`, or via a `saved_filter` whose resolved SQL references it.
// Resolving `saved_filter` here (against the fact table's own filters) keeps
// this scan self-contained rather than relying on a separate filter scan.
function rowFilterReferencesColumn(
  rowFilter: RowFilter,
  columnName: string,
  identifierQuote: SqlIdentifierQuote,
  filters: SavedFilter[],
): boolean {
  if (rowFilter.column === columnName) return true;
  if (
    rowFilter.operator === "sql_expr" &&
    rowFilter.values?.[0] &&
    sqlReferencesColumn(rowFilter.values[0], columnName, identifierQuote)
  ) {
    return true;
  }
  if (rowFilter.operator === "saved_filter" && rowFilter.values?.[0]) {
    const filter = filters.find((f) => f.id === rowFilter.values?.[0]);
    if (
      filter &&
      sqlReferencesColumn(filter.value, columnName, identifierQuote)
    ) {
      return true;
    }
  }
  return false;
}

function dimensionReferencesColumn(
  dimension: Dimension,
  columnName: string,
  identifierQuote: SqlIdentifierQuote,
  filters: SavedFilter[],
): boolean {
  switch (dimension.dimensionType) {
    case "date":
    case "dynamic":
    case "static":
      return dimension.column === columnName;
    case "slice":
      return dimension.slices.some((slice) =>
        slice.filters.some((f) =>
          rowFilterReferencesColumn(f, columnName, identifierQuote, filters),
        ),
      );
    default:
      return false;
  }
}

/**
 * Whether an exploration/dashboard-block config references `columnName` on the
 * fact table `factTableId`. Used to block deletion of a virtual column that a
 * saved exploration or dashboard block still depends on — those surfaces
 * persist `valueColumn`, dimension, and row-filter references (including
 * `saved_filter` references, resolved against `filters`) that resolve through
 * the same query-time chokepoint as metrics.
 */
export function explorationConfigReferencesColumn(
  config: ExplorationConfig,
  factTableId: string,
  columnName: string,
  identifierQuote: SqlIdentifierQuote,
  filters: SavedFilter[],
): boolean {
  if (config.type === "fact_table") {
    if (config.dataset.factTableId !== factTableId) return false;

    const valueReferences = config.dataset.values.some(
      (value) =>
        value.valueColumn === columnName ||
        value.rowFilters.some((f) =>
          rowFilterReferencesColumn(f, columnName, identifierQuote, filters),
        ),
    );
    if (valueReferences) return true;

    return config.dimensions.some((d) =>
      dimensionReferencesColumn(d, columnName, identifierQuote, filters),
    );
  }

  if (config.type === "funnel") {
    const stepMatches = config.dataset.steps.some(
      (step) =>
        step.factTable === factTableId &&
        step.rowFilters.some((f) =>
          rowFilterReferencesColumn(f, columnName, identifierQuote, filters),
        ),
    );
    if (stepMatches) return true;

    // Dimensions on a funnel are evaluated against the funnel's fact tables, so
    // only scan them when this fact table participates in the funnel.
    const usesFactTable = config.dataset.steps.some(
      (step) => step.factTable === factTableId,
    );
    if (!usesFactTable) return false;

    return config.dimensions.some((d) =>
      dimensionReferencesColumn(d, columnName, identifierQuote, filters),
    );
  }

  // metric / data_source configs never reference fact-table columns directly.
  return false;
}
