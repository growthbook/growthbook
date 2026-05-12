import { useMemo } from "react";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
} from "shared/enterprise";
import { FactTableInterface } from "shared/types/fact-table";
import type { HeaderStructure } from "@/components/Settings/DisplayTestQueryResults";
import {
  sortExplorationRows,
  getIsRatioByIndex,
  getEffectiveShowAs,
  buildExplorationColumns,
  getExplorationCellValue,
  formatDateByGranularity,
  formatDurationMs,
  getFunnelStepDisplayLabel,
  type ResolvedGranularity,
  type ExplorationColumn,
  type RenderOpts,
} from "@/enterprise/components/ProductAnalytics/util";
import { useDefinitions } from "@/services/DefinitionsContext";

/**
 * Format a raw cell value (from the shared column schema) for display in the
 * result table. The shared schema returns unformatted primitives; this adds
 * the UI-only concerns (date localization, rounding, Total fallback).
 */
function formatCellForTable(
  raw: string | number | null,
  col: ExplorationColumn,
  context: {
    resolvedGranularity: ResolvedGranularity | null;
    submittedExploreState: {
      dimensions?: { dimensionType?: string }[];
    } | null;
    hasNoDimensions: boolean;
  },
): unknown {
  if (col.kind === "dimension") {
    if (raw == null || raw === "") {
      return context.hasNoDimensions ? "Total" : "";
    }
    const d = context.submittedExploreState?.dimensions?.[col.dimIndex];
    if (
      d?.dimensionType === "date" &&
      typeof raw === "string" &&
      context.resolvedGranularity
    ) {
      return formatDateByGranularity(
        new Date(raw),
        context.resolvedGranularity,
      );
    }
    return raw;
  }
  if (raw == null) return "";
  if (col.sub === "numerator" || col.sub === "denominator") return raw;
  return typeof raw === "number" ? raw.toFixed(2) : raw;
}

export interface ExplorationTableData {
  rowData: Record<string, unknown>[];
  /** Stable machine keys used to index into each row object. */
  orderedColumnKeys: string[];
  /** Display labels, 1:1 aligned with orderedColumnKeys. */
  columnLabels: string[];
  headerStructure: HeaderStructure | null;
  explorationReturnedNoData: boolean;
}

/** Per-step subcolumn metadata for funnel result tables. */
const FUNNEL_STEP_SUBCOLS = [
  { key: "count", label: "Count" },
  { key: "fromPrev", label: "From prev" },
  { key: "fromStart", label: "From start" },
  { key: "avgTime", label: "Avg time" },
] as const;
type FunnelSubColKey = (typeof FUNNEL_STEP_SUBCOLS)[number]["key"];

function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Funnel result schema. Plan: wide format — one row per dimension value,
 * one column-group per step. When no dimension is set, fall back to a long
 * format (one row per step) for readability.
 */
function buildFunnelTableData(
  exploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactTableById: (id: string) => FactTableInterface | null,
): ExplorationTableData {
  if (submittedExploreState.dataset.type !== "funnel") {
    return {
      rowData: [],
      orderedColumnKeys: [],
      columnLabels: [],
      headerStructure: null,
      explorationReturnedNoData: true,
    };
  }
  const steps = submittedExploreState.dataset.steps;
  const rows = exploration?.result?.rows ?? [];
  const hasDimension = (submittedExploreState.dimensions?.length ?? 0) > 0;
  // Substitute filter previews for the default `Step N` names so table
  // column headers communicate which step is which. Passing `allSteps`
  // strips column+operator prefixes that are universal across every step
  // (e.g. `event_name=` when all steps filter on event_name).
  const stepLabels = steps.map((s, i) =>
    getFunnelStepDisplayLabel({
      step: s,
      factTable: s.factTable ? getFactTableById(s.factTable) : null,
      fallbackIndex: i,
      allSteps: steps,
    }),
  );

  if (!hasDimension) {
    // Long format: row per step, one row in the result.
    // The single row in `rows` (or none) drives this.
    const orderedColumnKeys = [
      "step",
      "count",
      "fromPrev",
      "fromStart",
      "avgTime",
    ];
    const columnLabels = [
      "Step",
      "Count",
      "Conv. from previous",
      "Conv. from start",
      "Avg. time from previous",
    ];
    const firstRow = rows[0];
    const stepResults = firstRow?.steps ?? [];
    const firstStepCount = stepResults[0]?.count ?? 0;
    const rowData = steps.map((step, i) => {
      const result = stepResults[i];
      const count = result?.count ?? 0;
      const prevCount = i > 0 ? stepResults[i - 1]?.count : null;
      const fromPrev =
        prevCount != null && prevCount > 0 ? count / prevCount : null;
      const fromStart = firstStepCount > 0 ? count / firstStepCount : null;
      const avgMs =
        result && result.timeFromPrevSumMs != null && result.count
          ? result.timeFromPrevSumMs / result.count
          : null;
      return {
        step: stepLabels[i] ?? step.name,
        count,
        fromPrev: i === 0 ? "—" : formatPct(fromPrev),
        fromStart: formatPct(fromStart),
        avgTime: i === 0 ? "—" : formatDurationMs(avgMs),
      } as Record<string, unknown>;
    });
    return {
      rowData,
      orderedColumnKeys,
      columnLabels,
      headerStructure: null,
      explorationReturnedNoData: !firstRow || stepResults.length === 0,
    };
  }

  // Wide format: row per dimension, one column-group per step.
  const dimensionLabel = (() => {
    const d = submittedExploreState.dimensions?.[0];
    if (!d) return "Dimension";
    if (d.dimensionType === "date") return "Date";
    if (d.dimensionType === "dynamic") return d.column ?? "Dimension";
    if (d.dimensionType === "static") return d.column;
    if (d.dimensionType === "slice") return "Slice";
    return "Dimension";
  })();

  const orderedColumnKeys: string[] = ["__dim_0__"];
  const columnLabels: string[] = [dimensionLabel];
  const row1: HeaderStructure["row1"] = [{ label: dimensionLabel, rowSpan: 2 }];
  const row2Labels: string[] = [];
  steps.forEach((step, stepIdx) => {
    const label = stepLabels[stepIdx] ?? step.name;
    row1.push({
      label,
      colSpan: FUNNEL_STEP_SUBCOLS.length,
    });
    FUNNEL_STEP_SUBCOLS.forEach((sub) => {
      const key = `__step_${stepIdx}_${sub.key}__`;
      orderedColumnKeys.push(key);
      columnLabels.push(`${label} ${sub.label}`);
      row2Labels.push(sub.label);
    });
  });
  const headerStructure: HeaderStructure = { row1, row2Labels };

  const rowData: Record<string, unknown>[] = [];
  // Sort by first-step count descending (matches the chart).
  const sortedRows = [...rows].sort(
    (a, b) => (b.steps?.[0]?.count ?? 0) - (a.steps?.[0]?.count ?? 0),
  );
  for (const row of sortedRows) {
    const out: Record<string, unknown> = {};
    out["__dim_0__"] = row.dimensions[0] ?? "";
    const stepResults = row.steps ?? [];
    const firstStepCount = stepResults[0]?.count ?? 0;
    steps.forEach((_step, stepIdx) => {
      const result = stepResults[stepIdx];
      const count = result?.count ?? 0;
      const prevCount = stepIdx > 0 ? stepResults[stepIdx - 1]?.count : null;
      const fromPrev =
        prevCount != null && prevCount > 0 ? count / prevCount : null;
      const fromStart = firstStepCount > 0 ? count / firstStepCount : null;
      const avgMs =
        result && result.timeFromPrevSumMs != null && result.count
          ? result.timeFromPrevSumMs / result.count
          : null;
      const subValues: Record<FunnelSubColKey, unknown> = {
        count,
        fromPrev: stepIdx === 0 ? "—" : formatPct(fromPrev),
        fromStart: formatPct(fromStart),
        avgTime: stepIdx === 0 ? "—" : formatDurationMs(avgMs),
      };
      FUNNEL_STEP_SUBCOLS.forEach((sub) => {
        out[`__step_${stepIdx}_${sub.key}__`] = subValues[sub.key];
      });
    });
    rowData.push(out);
  }

  return {
    rowData,
    orderedColumnKeys,
    columnLabels,
    headerStructure,
    explorationReturnedNoData: rowData.length === 0,
  };
}

export default function useExplorationTableData(
  exploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig | null,
): ExplorationTableData {
  const { getFactMetricById, getFactTableById } = useDefinitions();

  // Funnels have a wholly different column shape. Compute it once at the top
  // and bypass the rest of this hook (the metric/fact-table/data-source
  // shared schema below doesn't know about `row.steps`).
  const funnelTableData = useMemo(() => {
    if (submittedExploreState?.dataset?.type !== "funnel") return null;
    return buildFunnelTableData(
      exploration,
      submittedExploreState,
      getFactTableById,
    );
  }, [exploration, submittedExploreState, getFactTableById]);

  const renderOpts: RenderOpts = useMemo(
    () => ({
      showAs: getEffectiveShowAs(submittedExploreState, getFactMetricById),
      isRatioByIndex: getIsRatioByIndex(
        submittedExploreState,
        getFactMetricById,
      ),
    }),
    [submittedExploreState, getFactMetricById],
  );

  const columns = useMemo(
    () => buildExplorationColumns(submittedExploreState, getFactMetricById),
    [submittedExploreState, getFactMetricById],
  );

  const orderedColumnKeys = useMemo(() => columns.map((c) => c.key), [columns]);
  const columnLabels = useMemo(() => columns.map((c) => c.label), [columns]);

  const hasAnyRatio = useMemo(
    () => columns.some((c) => c.kind === "metric" && c.sub !== "single"),
    [columns],
  );

  const headerStructure = useMemo((): HeaderStructure | null => {
    if (!hasAnyRatio) return null;
    const row1: { label: string; colSpan?: number; rowSpan?: number }[] = [];
    const row2Labels: string[] = [];
    for (const col of columns) {
      if (col.kind === "dimension") {
        row1.push({ label: col.label, rowSpan: 2 });
        continue;
      }
      // Non-ratio metrics in a mixed (ratio + non-ratio) table span both
      // header rows so their column doesn't render a blank second-row cell
      // next to the ratio metric's Numerator / Denominator / Value trio.
      if (col.sub === "single") {
        row1.push({ label: col.label, rowSpan: 2 });
        continue;
      }
      const ds = submittedExploreState?.dataset;
      const metricName =
        (ds && ds.type !== "funnel"
          ? ds.values?.[col.metricIndex]?.name
          : undefined) ?? col.label;
      if (col.sub === "numerator") {
        row1.push({ label: metricName, colSpan: 3 });
      }
      row2Labels.push(
        col.sub === "numerator"
          ? "Numerator"
          : col.sub === "denominator"
            ? "Denominator"
            : "Value",
      );
    }
    return { row1, row2Labels };
  }, [hasAnyRatio, columns, submittedExploreState]);

  const resolvedGranularity = useMemo((): ResolvedGranularity | null => {
    if (!submittedExploreState) return null;
    const dateDimension = submittedExploreState.dimensions?.find(
      (d) => d.dimensionType === "date",
    );
    if (!dateDimension) return null;
    const dateRange = calculateProductAnalyticsDateRange(
      submittedExploreState.dateRange,
    );
    return getDateGranularity(dateDimension.dateGranularity, dateRange);
  }, [submittedExploreState]);

  const rowData = useMemo(() => {
    const rawRows = exploration?.result?.rows ?? [];
    const isTimeseries =
      submittedExploreState?.dimensions?.[0]?.dimensionType === "date";

    const sortedRows = sortExplorationRows(rawRows, isTimeseries, renderOpts);

    const hasNoDimensions =
      !submittedExploreState?.dimensions ||
      submittedExploreState.dimensions.length === 0;

    return sortedRows.map((row) => {
      const entries = columns.map((col) => {
        const raw = getExplorationCellValue(row, col, renderOpts);
        return [
          col.key,
          formatCellForTable(raw, col, {
            resolvedGranularity,
            submittedExploreState,
            hasNoDimensions,
          }),
        ] as const;
      });
      return Object.fromEntries(entries) as Record<string, unknown>;
    });
  }, [
    exploration?.result?.rows,
    columns,
    renderOpts,
    resolvedGranularity,
    submittedExploreState,
  ]);

  const explorationReturnedNoData = useMemo(() => {
    if (!exploration?.result?.rows?.length) return true;
    return exploration.result.rows.every(
      (r) => !(r.values?.length || r.steps?.length),
    );
  }, [exploration?.result?.rows]);

  if (funnelTableData) return funnelTableData;

  return {
    rowData,
    orderedColumnKeys,
    columnLabels,
    headerStructure,
    explorationReturnedNoData,
  };
}
