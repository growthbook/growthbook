import {
  FactTableInterface,
  FactMetricInterface,
} from "shared/types/fact-table";
import { ExplorationDataset } from "../../validators/product-analytics";
import { factTableHasResolvableColumn } from "./sql";

export interface AvailableDimensionColumn {
  column: string;
  name: string;
}

// Only what this module needs from a fact table — deliberately excludes
// `sql`, so callers can pass either a full FactTableInterface or the
// sql-less shape returned by an id-scoped "full columns" fetch (e.g. the
// front-end's useFullFactTablesByIds), without either satisfying the other.
export type DimensionFactTable = Pick<
  FactTableInterface,
  "columns" | "userIdTypes"
>;

// Top-level string columns, plus dotted sub-paths for JSON columns whose
// fields are themselves strings — matches the dotted-path convention
// `getColumnExpression`/`factTableHasResolvableColumn` resolve at query time.
function expandFactTableColumns(
  factTable: DimensionFactTable,
): AvailableDimensionColumn[] {
  const result: AvailableDimensionColumn[] = [];
  (factTable.columns || [])
    .filter((c) => !c.deleted)
    .forEach((c) => {
      if (c.datatype === "string") {
        result.push({ column: c.column, name: c.name || c.column });
      }
      if (c.datatype === "json" && c.jsonFields) {
        Object.entries(c.jsonFields).forEach(([field, info]) => {
          if (info.datatype === "string") {
            result.push({
              column: `${c.column}.${field}`,
              name: `${c.name || c.column}.${field}`,
            });
          }
        });
      }
    });
  return result;
}

/**
 * Columns (including dotted JSON sub-paths) valid to group by for a given
 * dataset. Single source of truth shared by the front-end Explorer's column
 * picker and the AI agent's `getAvailableColumns` tool, so both offer
 * exactly the columns a group-by query can actually resolve.
 *
 * For a ratio metric whose denominator lives on a different fact table than
 * the numerator, candidates are filtered down to columns (including nested
 * JSON paths) resolvable on *both* fact tables — `factTableHasResolvableColumn`
 * checks the full dotted path, not just the base column name, so a JSON
 * sub-field only offered when the denominator's own JSON column actually has
 * it too.
 *
 * Callers must pass FULL fact table data (real `jsonFields`) — a slim/
 * definitions-only fact table representation will silently under-report
 * nested JSON columns.
 */
export function getAvailableDimensionColumns(
  dataset: ExplorationDataset | null,
  getFactTableById: (id: string) => DimensionFactTable | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): AvailableDimensionColumn[] {
  if (!dataset) return [];
  if (dataset.type !== "funnel") {
    if (!dataset.values || dataset.values.length === 0) return [];
  } else {
    if (!dataset.steps || dataset.steps.length === 0) return [];
  }

  const userIdTypes = new Set<string>();
  let candidates: AvailableDimensionColumn[] | null = null;

  if (dataset.type === "fact_table") {
    const ft = getFactTableById(dataset.factTableId || "");
    ft?.userIdTypes?.forEach((u) => userIdTypes.add(u));
    candidates = ft ? expandFactTableColumns(ft) : [];
  } else if (dataset.type === "metric") {
    for (const value of dataset.values) {
      const factMetric = getFactMetricById(value.metricId);
      if (!factMetric) continue;
      const ft = getFactTableById(factMetric.numerator.factTableId);
      if (!ft) continue;
      ft.userIdTypes?.forEach((u) => userIdTypes.add(u));

      let valueCandidates = expandFactTableColumns(ft);

      // A ratio metric's denominator can live on a different fact table —
      // only offer columns (including nested JSON paths) both sides can
      // resolve, so a dimension can never be picked that a group-by query
      // can't evaluate on the denominator.
      if (factMetric.denominator?.factTableId) {
        const denominatorFt = getFactTableById(
          factMetric.denominator.factTableId,
        );
        denominatorFt?.userIdTypes?.forEach((u) => userIdTypes.add(u));
        valueCandidates = denominatorFt
          ? valueCandidates.filter((c) =>
              factTableHasResolvableColumn(denominatorFt, c.column),
            )
          : [];
      }

      if (candidates === null) {
        candidates = valueCandidates;
      } else {
        const names = new Set(valueCandidates.map((c) => c.column));
        candidates = candidates.filter((c) => names.has(c.column));
      }
    }
  } else if (dataset.type === "data_source") {
    candidates = Object.entries(dataset.columnTypes)
      .filter(([, datatype]) => datatype === "string")
      .map(([name]) => ({ column: name, name }));
  } else if (dataset.type === "funnel") {
    const initialStep = dataset.steps[0];
    const ft = initialStep?.factTableId
      ? getFactTableById(initialStep.factTableId)
      : null;
    ft?.userIdTypes?.forEach((u) => userIdTypes.add(u));
    candidates = ft ? expandFactTableColumns(ft) : [];
  }

  return (candidates || [])
    .filter((c) => !userIdTypes.has(c.column))
    .sort((a, b) => a.name.localeCompare(b.name));
}
