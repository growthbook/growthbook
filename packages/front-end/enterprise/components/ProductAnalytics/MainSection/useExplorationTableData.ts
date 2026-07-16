import { useMemo } from "react";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import type { FactMetricInterface } from "shared/types/fact-table";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
  buildAlignedComparisonRowLookup,
} from "shared/enterprise";
import type { HeaderStructure } from "@/components/Settings/DisplayTestQueryResults";
import {
  sortExplorationRows,
  getIsRatioByIndex,
  getEffectiveShowAs,
  buildExplorationColumns,
  getExplorationCellValue,
  formatDateByGranularity,
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

export default function useExplorationTableData(
  exploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig | null,
  options?: {
    compareEnabled?: boolean;
    comparisonExploration?: ProductAnalyticsExploration | null;
    /** When set, `%` trend cells come from the server (aligned to sorted primary rows). */
    serverTableTrendsByRow?: Record<string, number | null>[] | null;
    /** Override for the public dashboard page; defaults to useDefinitions(). */
    getFactMetricById?: (id: string) => FactMetricInterface | null;
  },
): ExplorationTableData {
  const { getFactMetricById: defGetFactMetricById } = useDefinitions();
  const getFactMetricById = options?.getFactMetricById ?? defGetFactMetricById;
  const compareEnabled = options?.compareEnabled ?? false;
  const comparisonExploration = options?.comparisonExploration ?? null;
  const serverTableTrendsByRow = options?.serverTableTrendsByRow ?? null;

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
            submittedExploreState.dataset?.values?.[col.metricIndex]?.name ??
            col.label;
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
            submittedExploreState.dataset?.values?.[col.metricIndex]?.name ??
            col.label;
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
      const metricName =
        submittedExploreState?.dataset?.values?.[col.metricIndex]?.name ??
        col.label;
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
    return exploration.result.rows.every((r) => r.values.length === 0);
  }, [exploration?.result?.rows]);

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
