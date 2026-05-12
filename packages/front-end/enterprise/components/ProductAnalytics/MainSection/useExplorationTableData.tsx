import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
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
import ComparisonTrendLabel from "@/enterprise/components/ProductAnalytics/ComparisonTrendLabel";
import {
  buildComparisonTrend,
  findComparisonRow,
  getComparisonMetricValue,
  formatComparisonMetricLabel,
  getComparisonPeriodLabels,
} from "@/enterprise/components/ProductAnalytics/compareUtil";
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
): string | number {
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

function getPreviousPeriodColumnKey(columnKey: string): string {
  return `${columnKey}__compare__`;
}

function shouldCompareColumn(
  compareEnabled: boolean,
  col: ExplorationColumn,
): boolean {
  return (
    compareEnabled &&
    col.kind === "metric" &&
    (col.sub === "single" || col.sub === "value")
  );
}

export interface ExplorationTableData {
  rowData: Record<string, unknown>[];
  /** Primitive-only rows used for CSV export (no inline compare UI). */
  exportRowData: Record<string, string | number>[];
  /** Stable machine keys used to index into each row object. */
  orderedColumnKeys: string[];
  /** Display labels, 1:1 aligned with orderedColumnKeys. */
  columnLabels: string[];
  headerStructure: HeaderStructure | null;
  explorationReturnedNoData: boolean;
}

export default function useExplorationTableData(
  exploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig | null,
  options?: {
    compareEnabled?: boolean;
    comparisonExploration?: ProductAnalyticsExploration | null;
  },
): ExplorationTableData {
  const compareEnabled = options?.compareEnabled ?? false;
  const comparisonExploration = options?.comparisonExploration ?? null;
  const { getFactMetricById } = useDefinitions();

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

  const comparisonPeriodLabels = useMemo(() => {
    if (!compareEnabled || !submittedExploreState) {
      return null;
    }
    return getComparisonPeriodLabels(submittedExploreState.dateRange);
  }, [compareEnabled, submittedExploreState]);

  const orderedColumnKeys = useMemo(() => {
    const keys: string[] = [];
    for (const col of columns) {
      keys.push(col.key);
      if (shouldCompareColumn(compareEnabled, col)) {
        keys.push(getPreviousPeriodColumnKey(col.key));
      }
    }
    return keys;
  }, [columns, compareEnabled]);

  const columnLabels = useMemo(() => {
    const labels: string[] = [];
    for (const col of columns) {
      if (shouldCompareColumn(compareEnabled, col) && comparisonPeriodLabels) {
        labels.push(
          formatComparisonMetricLabel(
            col.label,
            comparisonPeriodLabels.currentLabel,
          ),
        );
        labels.push(
          formatComparisonMetricLabel(
            col.label,
            comparisonPeriodLabels.previousLabel,
          ),
        );
        continue;
      }

      labels.push(col.label);
    }
    return labels;
  }, [columns, compareEnabled, comparisonPeriodLabels]);

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

  const { rowData, exportRowData } = useMemo(() => {
    const rawRows = exploration?.result?.rows ?? [];
    const isTimeseries =
      submittedExploreState?.dimensions?.[0]?.dimensionType === "date";

    const sortedRows = sortExplorationRows(rawRows, isTimeseries, renderOpts);

    const hasNoDimensions =
      !submittedExploreState?.dimensions ||
      submittedExploreState.dimensions.length === 0;

    const comparisonRows =
      compareEnabled && comparisonExploration?.result?.rows
        ? sortExplorationRows(
            comparisonExploration.result.rows,
            isTimeseries,
            renderOpts,
          )
        : [];

    const displayRows: Record<string, unknown>[] = [];
    const csvRows: Record<string, string | number>[] = [];

    for (const [rowIndex, row] of sortedRows.entries()) {
      const comparisonRow = compareEnabled
        ? findComparisonRow(row, comparisonRows, rowIndex, isTimeseries)
        : null;

      const displayEntries: [string, unknown][] = [];
      const exportEntries: [string, string | number][] = [];

      for (const col of columns) {
        const raw = getExplorationCellValue(row, col, renderOpts);
        const formatted = formatCellForTable(raw, col, {
          resolvedGranularity,
          submittedExploreState,
          hasNoDimensions,
        });

        if (!shouldCompareColumn(compareEnabled, col)) {
          displayEntries.push([col.key, formatted]);
          exportEntries.push([col.key, formatted]);
          continue;
        }

        const currentValue =
          typeof raw === "number" ? raw : raw === null ? 0 : Number(raw);
        const previousValue = getComparisonMetricValue(
          comparisonRow,
          col,
          renderOpts,
        );
        const trend = buildComparisonTrend(currentValue, previousValue);
        const previousRaw = comparisonRow
          ? getExplorationCellValue(comparisonRow, col, renderOpts)
          : null;
        const previousFormatted = formatCellForTable(previousRaw, col, {
          resolvedGranularity,
          submittedExploreState,
          hasNoDimensions,
        });
        const previousColumnKey = getPreviousPeriodColumnKey(col.key);

        displayEntries.push([
          col.key,
          <Flex
            key={col.key}
            direction="row"
            align="center"
            gap="1"
            wrap="wrap"
          >
            <span>{String(formatted)}</span>
            <ComparisonTrendLabel trend={trend} />
          </Flex>,
        ]);
        displayEntries.push([previousColumnKey, previousFormatted]);
        exportEntries.push([col.key, formatted]);
        exportEntries.push([previousColumnKey, previousFormatted]);
      }

      displayRows.push(Object.fromEntries(displayEntries));
      csvRows.push(Object.fromEntries(exportEntries));
    }

    return { rowData: displayRows, exportRowData: csvRows };
  }, [
    exploration?.result?.rows,
    comparisonExploration?.result?.rows,
    compareEnabled,
    columns,
    renderOpts,
    resolvedGranularity,
    submittedExploreState,
  ]);

  const explorationReturnedNoData = useMemo(() => {
    if (!exploration?.result?.rows?.length) return true;
    return exploration.result.rows.every((r) => r.values.length === 0);
  }, [exploration?.result?.rows]);

  return {
    rowData,
    exportRowData,
    orderedColumnKeys,
    columnLabels,
    headerStructure,
    explorationReturnedNoData,
  };
}
