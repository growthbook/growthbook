import {
  FactMetricInterface,
  FactTableInterface,
  RowFilter,
} from "shared/types/fact-table";
import {
  FactMetricMatchSpec,
  FactTableMatch,
} from "back-end/src/enterprise/services/dashboard-templates/types";

// Canonical representation of a single row filter used for equality. Saved
// filters reference a FactFilter by name; we expand those to the underlying
// column/operator/values payload before comparing so that semantically
// equivalent metrics still match regardless of whether the user wrote the
// filter inline or via a saved filter.
type NormalizedFilter =
  | {
      kind: "predicate";
      column: string;
      operator: string;
      values: string[];
    }
  | {
      // SQL expression filters we cannot meaningfully canonicalize; we
      // keep the raw value so two metrics that share the same SQL filter
      // still compare equal, but we never claim semantic equivalence
      // between an inline filter and an SQL expression filter.
      kind: "sql_expr";
      value: string;
    };

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function normalizeOperator(op?: string): string {
  return (op ?? "=").toLowerCase();
}

// Expand a single row filter into one or more normalized predicates.
// `saved_filter` references can resolve to one or more underlying SQL
// expressions: we look up by id first (matching how stored fact metrics
// reference filters) and fall back to name (matching how templates often
// reference filters by their human label). Each resolved value becomes
// its own normalized entry. If the filter can't be resolved, it produces
// no entries (so it can't accidentally match).
function expandRowFilter(
  filter: RowFilter,
  factTable: FactTableInterface | null,
): NormalizedFilter[] {
  if (filter.operator === "saved_filter") {
    if (!factTable) return [];
    const identifiers = filter.values ?? [];
    return identifiers.flatMap((idOrName) => {
      const saved =
        factTable.filters.find((f) => f.id === idOrName) ||
        factTable.filters.find((f) => f.name === idOrName);
      if (!saved) return [];
      return [{ kind: "sql_expr" as const, value: saved.value.trim() }];
    });
  }
  if (filter.operator === "sql_expr") {
    const values = filter.values ?? [];
    return values.map((v) => ({ kind: "sql_expr" as const, value: v.trim() }));
  }
  return [
    {
      kind: "predicate",
      column: filter.column ?? "",
      operator: normalizeOperator(filter.operator),
      values: unique(filter.values ?? []),
    },
  ];
}

// Stable canonical key for a NormalizedFilter used for set comparison.
function filterKey(f: NormalizedFilter): string {
  if (f.kind === "sql_expr") {
    return `sql_expr::${f.value}`;
  }
  return `${f.column}::${f.operator}::${f.values.join("|")}`;
}

// Build a stable set representation of a row filter list. Order is not
// meaningful; duplicates collapse.
export function normalizeRowFilters(
  filters: RowFilter[],
  factTable: FactTableInterface | null,
): string[] {
  const keys = filters
    .flatMap((f) => expandRowFilter(f, factTable))
    .map(filterKey);
  return Array.from(new Set(keys)).sort();
}

function rowFilterSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Compare a fact metric's definition against a template's matchSpec.
// Strict equality on metricType, numerator column, normalized numerator
// rowFilters, and (when present on either side) denominator column +
// rowFilters. We accept normalizing missing rowFilters as the empty set.
export function factMetricMatchesSpec(
  metric: FactMetricInterface,
  spec: FactMetricMatchSpec,
  factTablesById: Map<string, FactTableInterface>,
): boolean {
  if (metric.metricType !== spec.metricType) return false;

  if (metric.numerator.column !== spec.numerator.column) return false;

  const numeratorFactTable =
    factTablesById.get(metric.numerator.factTableId) ?? null;

  const metricNumeratorFilters = normalizeRowFilters(
    metric.numerator.rowFilters ?? [],
    numeratorFactTable,
  );
  const specNumeratorFilters = normalizeRowFilters(
    spec.numerator.rowFilters,
    numeratorFactTable,
  );
  if (!rowFilterSetsEqual(metricNumeratorFilters, specNumeratorFilters)) {
    return false;
  }

  const hasMetricDenominator = !!metric.denominator;
  const hasSpecDenominator = !!spec.denominator;
  if (hasMetricDenominator !== hasSpecDenominator) return false;

  if (metric.denominator && spec.denominator) {
    if (metric.denominator.column !== spec.denominator.column) return false;
    const denominatorFactTable =
      factTablesById.get(metric.denominator.factTableId) ?? null;
    const metricDenominatorFilters = normalizeRowFilters(
      metric.denominator.rowFilters ?? [],
      denominatorFactTable,
    );
    const specDenominatorFilters = normalizeRowFilters(
      spec.denominator.rowFilters,
      denominatorFactTable,
    );
    if (!rowFilterSetsEqual(metricDenominatorFilters, specDenominatorFilters)) {
      return false;
    }
  }

  return true;
}

// Pick the first matching fact metric in deterministic order (ascending
// dateCreated; tiebreak on id for stability). Searches across every fact
// table the user has on this datasource since the matching is purely
// structural.
export function findMatchingFactMetric(
  factMetrics: FactMetricInterface[],
  spec: FactMetricMatchSpec,
  factTablesById: Map<string, FactTableInterface>,
): FactMetricInterface | null {
  const sorted = [...factMetrics].sort((a, b) => {
    const aTime = a.dateCreated?.getTime?.() ?? 0;
    const bTime = b.dateCreated?.getTime?.() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.id.localeCompare(b.id);
  });
  for (const metric of sorted) {
    if (factMetricMatchesSpec(metric, spec, factTablesById)) {
      return metric;
    }
  }
  return null;
}

// Find the first fact table on this datasource whose non-deleted columns
// contain every required column. Deterministic order: ascending
// dateCreated, then id.
export function findMatchingFactTable(
  factTables: FactTableInterface[],
  match: FactTableMatch,
): FactTableInterface | null {
  if (!match.requiredColumns.length) {
    // A template that requires no specific columns shouldn't be a
    // fact-table-exploration intent; treat as no match to surface bugs.
    return null;
  }
  const sorted = [...factTables].sort((a, b) => {
    const aTime = a.dateCreated?.getTime?.() ?? 0;
    const bTime = b.dateCreated?.getTime?.() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.id.localeCompare(b.id);
  });
  for (const factTable of sorted) {
    const available = new Set(
      factTable.columns.filter((c) => !c.deleted).map((c) => c.column),
    );
    if (match.requiredColumns.every((col) => available.has(col))) {
      return factTable;
    }
  }
  return null;
}
