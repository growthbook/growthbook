import { useMemo } from "react";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
  buildAlignedComparisonRowLookup,
} from "shared/enterprise";
import { FactTableDefinition } from "shared/types/fact-table";
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

/**
 * Metadata for each ordered table column when date-range comparison is active.
 * Row keys still use `__prev` / `__curr` / `__trend` suffixes for stable CSV export;
 * this object describes their role so callers need not parse key strings.
 */
export type ExplorationTableCompareColumnMeta =
  | { compareCell: "previous" }
  | {
      compareCell: "current";
      /** Row key for the synthetic `%` change paired with this column. */
      trendRowKey: string;
    };

/**
 * Column key for the dedicated "previous date" column rendered right after the
 * current-period date column in compare mode (timeseries only). Holds the
 * aligned previous-period bucket date so it reads as a parallel date column
 * rather than being tucked inside each previous metric cell.
 */
const PREV_BUCKET_DATE_KEY = "__prevBucketDate";

export interface ExplorationTableData {
  rowData: Record<string, unknown>[];
  /** Stable machine keys used to index into each row object. */
  orderedColumnKeys: string[];
  /** Display labels, 1:1 aligned with orderedColumnKeys. */
  columnLabels: string[];
  headerStructure: HeaderStructure | null;
  explorationReturnedNoData: boolean;
  csvColumnKeys?: string[];
  csvColumnLabels?: string[];
  /** When true, rows include `__prev` / `__curr` / `__trend` keys per metric column. */
  tableCompareActive: boolean;
  /**
   * When `tableCompareActive`, maps ordered column keys for compared metrics to
   * `previous` / `current` (and trend key for current). Dimension keys are omitted.
   */
  compareColumnMetaByKey?: Record<string, ExplorationTableCompareColumnMeta>;
}

/** Per-step subcolumn metadata for funnel result tables. */
const FUNNEL_STEP_SUBCOLS = [
  { key: "count", label: "Count" },
  { key: "fromPrev", label: "From prev" },
  { key: "fromStart", label: "From start" },
  { key: "avgTime", label: "Avg time" },
] as const;

function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Funnel result schema. Plan: wide format — one row per dimension value,
 * one column-group per step. When no dimension is set, fall back to a long
 * format (one row per step) for readability.
 */
function computeCountTrend(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function buildFunnelTableData(
  exploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactTableById: (id: string) => FactTableDefinition | null,
  comparisonExploration?: ProductAnalyticsExploration | null,
): ExplorationTableData {
  if (submittedExploreState.dataset.type !== "funnel") {
    return {
      rowData: [],
      orderedColumnKeys: [],
      columnLabels: [],
      headerStructure: null,
      explorationReturnedNoData: true,
      tableCompareActive: false,
    };
  }
  const steps = submittedExploreState.dataset.steps;
  const rows = exploration?.result?.rows ?? [];
  const cmpRows = comparisonExploration?.result?.rows ?? [];
  const compareActive = cmpRows.length > 0;
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
    const orderedColumnKeys = compareActive
      ? [
          "step",
          "count__curr",
          "count__prev",
          "fromPrev",
          "fromStart",
          "avgTime",
        ]
      : ["step", "count", "fromPrev", "fromStart", "avgTime"];
    const columnLabels = compareActive
      ? [
          "Step",
          "Count — Current",
          "Count — Previous",
          "Conv. from previous",
          "Conv. from start",
          "Avg. time from previous",
        ]
      : [
          "Step",
          "Count",
          "Conv. from previous",
          "Conv. from start",
          "Avg. time from previous",
        ];

    const compareColumnMetaByKey: Record<
      string,
      ExplorationTableCompareColumnMeta
    > = compareActive
      ? {
          count__prev: { compareCell: "previous" },
          count__curr: { compareCell: "current", trendRowKey: "count__trend" },
        }
      : {};

    const firstRow = rows[0];
    const stepResults = firstRow?.steps ?? [];
    const firstStepCount = stepResults[0]?.count ?? 0;
    const cmpStepResults = cmpRows[0]?.steps ?? [];

    const rowData = steps.map((step, i) => {
      const result = stepResults[i];
      const count = result?.count ?? 0;
      const prevStepCount = i > 0 ? stepResults[i - 1]?.count : null;
      const fromPrev =
        prevStepCount != null && prevStepCount > 0
          ? count / prevStepCount
          : null;
      const fromStart = firstStepCount > 0 ? count / firstStepCount : null;
      const avgMs =
        result && result.timeFromPrevSumMs != null && result.count
          ? result.timeFromPrevSumMs / result.count
          : null;

      const out: Record<string, unknown> = {
        step: stepLabels[i] ?? step.name,
        fromPrev: i === 0 ? "—" : formatPct(fromPrev),
        fromStart: formatPct(fromStart),
        avgTime: i === 0 ? "—" : formatDurationMs(avgMs),
      };
      if (compareActive) {
        const cmpCount = cmpStepResults[i]?.count ?? 0;
        out["count__curr"] = count;
        out["count__prev"] = cmpCount;
        out["count__trend"] = computeCountTrend(count, cmpCount);
      } else {
        out["count"] = count;
      }
      return out;
    });
    return {
      rowData,
      orderedColumnKeys,
      columnLabels,
      headerStructure: null,
      explorationReturnedNoData: !firstRow || stepResults.length === 0,
      tableCompareActive: compareActive,
      ...(compareActive ? { compareColumnMetaByKey } : {}),
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
  const compareColumnMetaByKey: Record<
    string,
    ExplorationTableCompareColumnMeta
  > = {};

  steps.forEach((step, stepIdx) => {
    const label = stepLabels[stepIdx] ?? step.name;
    const subColCount = compareActive
      ? FUNNEL_STEP_SUBCOLS.length + 1
      : FUNNEL_STEP_SUBCOLS.length;
    row1.push({ label, colSpan: subColCount });
    FUNNEL_STEP_SUBCOLS.forEach((sub) => {
      if (sub.key === "count" && compareActive) {
        const currKey = `__step_${stepIdx}_count_curr__`;
        const prevKey = `__step_${stepIdx}_count_prev__`;
        const trendKey = `__step_${stepIdx}_count_trend__`;
        orderedColumnKeys.push(currKey, prevKey);
        columnLabels.push(
          `${label} Count — Current`,
          `${label} Count — Previous`,
        );
        row2Labels.push("Count (curr)", "Count (prev)");
        compareColumnMetaByKey[prevKey] = { compareCell: "previous" };
        compareColumnMetaByKey[currKey] = {
          compareCell: "current",
          trendRowKey: trendKey,
        };
      } else {
        const key = `__step_${stepIdx}_${sub.key}__`;
        orderedColumnKeys.push(key);
        columnLabels.push(`${label} ${sub.label}`);
        row2Labels.push(sub.label);
      }
    });
  });
  const headerStructure: HeaderStructure = { row1, row2Labels };

  const sortedRows = [...rows].sort(
    (a, b) => (b.steps?.[0]?.count ?? 0) - (a.steps?.[0]?.count ?? 0),
  );

  const firstDimensionIsDate =
    submittedExploreState.dimensions?.[0]?.dimensionType === "date";
  const getAlignedCmpRow = compareActive
    ? buildAlignedComparisonRowLookup(sortedRows, cmpRows, firstDimensionIsDate)
    : null;

  const rowData: Record<string, unknown>[] = [];
  for (const row of sortedRows) {
    const out: Record<string, unknown> = {};
    out["__dim_0__"] = row.dimensions[0] ?? "";
    const stepResults = row.steps ?? [];
    const firstStepCount = stepResults[0]?.count ?? 0;
    const cmpRow = getAlignedCmpRow?.(row.dimensions) ?? null;
    const cmpStepResults = cmpRow?.steps ?? [];

    steps.forEach((_step, stepIdx) => {
      const result = stepResults[stepIdx];
      const count = result?.count ?? 0;
      const prevStepCount =
        stepIdx > 0 ? stepResults[stepIdx - 1]?.count : null;
      const fromPrev =
        prevStepCount != null && prevStepCount > 0
          ? count / prevStepCount
          : null;
      const fromStart = firstStepCount > 0 ? count / firstStepCount : null;
      const avgMs =
        result && result.timeFromPrevSumMs != null && result.count
          ? result.timeFromPrevSumMs / result.count
          : null;

      if (compareActive) {
        const cmpCount = cmpStepResults[stepIdx]?.count ?? 0;
        out[`__step_${stepIdx}_count_curr__`] = count;
        out[`__step_${stepIdx}_count_prev__`] = cmpCount;
        out[`__step_${stepIdx}_count_trend__`] = computeCountTrend(
          count,
          cmpCount,
        );
      } else {
        out[`__step_${stepIdx}_count__`] = count;
      }
      out[`__step_${stepIdx}_fromPrev__`] =
        stepIdx === 0 ? "—" : formatPct(fromPrev);
      out[`__step_${stepIdx}_fromStart__`] = formatPct(fromStart);
      out[`__step_${stepIdx}_avgTime__`] =
        stepIdx === 0 ? "—" : formatDurationMs(avgMs);
    });
    rowData.push(out);
  }

  return {
    rowData,
    orderedColumnKeys,
    columnLabels,
    headerStructure,
    explorationReturnedNoData: rowData.length === 0,
    tableCompareActive: compareActive,
    ...(compareActive ? { compareColumnMetaByKey } : {}),
  };
}

export default function useExplorationTableData(
  exploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig | null,
  options?: {
    compareEnabled?: boolean;
    comparisonExploration?: ProductAnalyticsExploration | null;
    /** When set, `%` trend cells come from the server (aligned to sorted primary rows). */
    serverTableTrendsByRow?: Record<string, number | null>[] | null;
  },
): ExplorationTableData {
  const { getFactMetricById, getFactTableById } = useDefinitions();
  const compareEnabled = options?.compareEnabled ?? false;
  const comparisonExploration = options?.comparisonExploration ?? null;
  const serverTableTrendsByRow = options?.serverTableTrendsByRow ?? null;

  // Funnels have a wholly different column shape. Compute it once at the top
  // and bypass the rest of this hook (the metric/fact-table/data-source
  // shared schema below doesn't know about `row.steps`).
  const funnelTableData = useMemo(() => {
    if (submittedExploreState?.dataset?.type !== "funnel") return null;
    return buildFunnelTableData(
      exploration,
      submittedExploreState,
      getFactTableById,
      compareEnabled ? comparisonExploration : null,
    );
  }, [
    exploration,
    submittedExploreState,
    getFactTableById,
    compareEnabled,
    comparisonExploration,
  ]);

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

  const hasAnyRatio = useMemo(
    () => columns.some((c) => c.kind === "metric" && c.sub !== "single"),
    [columns],
  );

  const firstDimensionIsDate = useMemo(
    () => submittedExploreState?.dimensions?.[0]?.dimensionType === "date",
    [submittedExploreState],
  );

  const tableCompareActive = useMemo(
    () =>
      Boolean(
        compareEnabled &&
          comparisonExploration?.result?.rows?.length &&
          !hasAnyRatio,
      ),
    [compareEnabled, comparisonExploration?.result?.rows?.length, hasAnyRatio],
  );

  const orderedColumnKeys = useMemo(() => {
    if (tableCompareActive) {
      const keys: string[] = [];
      columns.forEach((col, i) => {
        if (col.kind === "dimension") {
          keys.push(col.key);
        } else if (col.sub === "single") {
          keys.push(`${col.key}__curr`, `${col.key}__prev`);
        }
        // Insert the previous-date column immediately after the current date
        // column so the two read as a parallel pair.
        if (i === 0 && firstDimensionIsDate) {
          keys.push(PREV_BUCKET_DATE_KEY);
        }
      });
      return keys;
    }
    return columns.map((c) => c.key);
  }, [tableCompareActive, columns, firstDimensionIsDate]);

  const compareColumnMetaByKey = useMemo(():
    | Record<string, ExplorationTableCompareColumnMeta>
    | undefined => {
    if (!tableCompareActive) return undefined;
    const meta: Record<string, ExplorationTableCompareColumnMeta> = {};
    for (const col of columns) {
      if (col.kind === "dimension") continue;
      if (col.sub !== "single") continue;
      const prevKey = `${col.key}__prev`;
      const currKey = `${col.key}__curr`;
      const trendKey = `${col.key}__trend`;
      meta[prevKey] = { compareCell: "previous" };
      meta[currKey] = { compareCell: "current", trendRowKey: trendKey };
    }
    return meta;
  }, [tableCompareActive, columns]);

  // Compare metric columns are labelled "Current" / "Previous"; the specific
  // windows are conveyed by the current date column and the dedicated previous
  // date column beside it.
  const compareHeadings = useMemo(() => {
    if (!tableCompareActive || !submittedExploreState) return null;
    return { currHeading: "Current", prevHeading: "Previous" };
  }, [tableCompareActive, submittedExploreState]);

  const columnLabels = useMemo(() => {
    if (submittedExploreState && compareHeadings) {
      const { prevHeading, currHeading } = compareHeadings;
      const labels: string[] = [];
      columns.forEach((col, i) => {
        if (col.kind === "dimension") {
          labels.push(col.label);
        } else if (col.sub === "single") {
          const metricName =
            (submittedExploreState.dataset?.type !== "funnel"
              ? submittedExploreState.dataset?.values?.[col.metricIndex]?.name
              : undefined) ?? col.label;
          labels.push(
            `${metricName} — ${currHeading}`,
            `${metricName} — ${prevHeading}`,
          );
        }
        if (i === 0 && firstDimensionIsDate) {
          labels.push(`${columns[0].label} (previous)`);
        }
      });
      return labels;
    }
    return columns.map((c) => c.label);
  }, [columns, submittedExploreState, compareHeadings, firstDimensionIsDate]);

  // The on-screen columns already include the dedicated previous-date column,
  // so the CSV mirrors them directly.
  const csvColumnKeys = useMemo(
    () => (tableCompareActive ? orderedColumnKeys : undefined),
    [tableCompareActive, orderedColumnKeys],
  );

  const csvColumnLabels = useMemo(
    () => (tableCompareActive ? columnLabels : undefined),
    [tableCompareActive, columnLabels],
  );

  const headerStructure = useMemo((): HeaderStructure | null => {
    if (submittedExploreState && compareHeadings) {
      const { prevHeading, currHeading } = compareHeadings;
      const row1: { label: string; colSpan?: number; rowSpan?: number }[] = [];
      const row2Labels: string[] = [];
      columns.forEach((col, i) => {
        if (col.kind === "dimension") {
          row1.push({ label: col.label, rowSpan: 2 });
        } else if (col.sub === "single") {
          const metricName =
            (submittedExploreState.dataset?.type !== "funnel"
              ? submittedExploreState.dataset?.values?.[col.metricIndex]?.name
              : undefined) ?? col.label;
          row1.push({ label: metricName, colSpan: 2 });
          row2Labels.push(currHeading, prevHeading);
        }
        // Dedicated previous-date column, mirroring orderedColumnKeys.
        if (i === 0 && firstDimensionIsDate) {
          row1.push({ label: `${columns[0].label} (previous)`, rowSpan: 2 });
        }
      });
      return { row1, row2Labels };
    }

    if (!hasAnyRatio) return null;
    const row1: { label: string; colSpan?: number; rowSpan?: number }[] = [];
    const row2Labels: string[] = [];
    for (const col of columns) {
      if (col.kind === "dimension") {
        row1.push({ label: col.label, rowSpan: 2 });
        continue;
      }
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
  }, [
    hasAnyRatio,
    columns,
    submittedExploreState,
    compareHeadings,
    firstDimensionIsDate,
  ]);

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

    const fmtCtx = {
      resolvedGranularity,
      submittedExploreState,
      hasNoDimensions,
    };

    if (tableCompareActive && comparisonExploration?.result?.rows) {
      const cmpSorted = sortExplorationRows(
        comparisonExploration.result.rows,
        isTimeseries,
        renderOpts,
      );
      const getAlignedCmpRow = buildAlignedComparisonRowLookup(
        sortedRows,
        cmpSorted,
        isTimeseries,
      );
      return sortedRows.map((row, idx) => {
        // Pair by dimension key for both timeseries and categorical charts.
        // Positional pairing (cmpSorted[idx]) would mis-match categories when
        // the two periods sort differently (e.g. "USA" current vs "Canada" prev).
        const cmpRow = getAlignedCmpRow(row.dimensions);
        const entries: [string, unknown][] = [];
        // Aligned previous-period bucket date for this row (timeseries only),
        // rendered as the dedicated previous-date column beside the current one.
        if (firstDimensionIsDate) {
          const prevDim0 = cmpRow?.dimensions?.[0] ?? null;
          entries.push([
            PREV_BUCKET_DATE_KEY,
            typeof prevDim0 === "string" && resolvedGranularity
              ? formatDateByGranularity(new Date(prevDim0), resolvedGranularity)
              : null,
          ] as const);
        }
        for (const col of columns) {
          if (col.kind === "dimension") {
            const raw = getExplorationCellValue(row, col, renderOpts);
            entries.push([
              col.key,
              formatCellForTable(raw, col, fmtCtx),
            ] as const);
            continue;
          }
          if (col.sub === "single") {
            const rawCurr = getExplorationCellValue(row, col, renderOpts);
            const rawPrev = cmpRow
              ? getExplorationCellValue(cmpRow, col, renderOpts)
              : null;
            const prevKey = `${col.key}__prev`;
            const currKey = `${col.key}__curr`;
            const trendKey = `${col.key}__trend`;
            let trend: number | null = null;
            const serverRow = serverTableTrendsByRow?.[idx];
            if (serverRow && trendKey in serverRow) {
              trend = serverRow[trendKey] ?? null;
            } else if (
              typeof rawPrev === "number" &&
              typeof rawCurr === "number" &&
              rawPrev !== 0
            ) {
              trend = ((rawCurr - rawPrev) / rawPrev) * 100;
            }
            entries.push(
              [currKey, formatCellForTable(rawCurr, col, fmtCtx)] as const,
              [prevKey, formatCellForTable(rawPrev, col, fmtCtx)] as const,
              [trendKey, trend] as const,
            );
          }
        }
        return Object.fromEntries(entries) as Record<string, unknown>;
      });
    }

    return sortedRows.map((row) => {
      const entries = columns.map((col) => {
        const raw = getExplorationCellValue(row, col, renderOpts);
        return [col.key, formatCellForTable(raw, col, fmtCtx)] as const;
      });
      return Object.fromEntries(entries) as Record<string, unknown>;
    });
  }, [
    columns,
    comparisonExploration?.result?.rows,
    exploration?.result?.rows,
    firstDimensionIsDate,
    renderOpts,
    resolvedGranularity,
    serverTableTrendsByRow,
    submittedExploreState,
    tableCompareActive,
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
    tableCompareActive,
    ...(tableCompareActive
      ? { csvColumnKeys, csvColumnLabels, compareColumnMetaByKey }
      : {}),
  };
}
