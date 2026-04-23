import { useMemo } from "react";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import type { HeaderStructure } from "@/components/Settings/DisplayTestQueryResults";
import {
  sortExplorationRows,
  getIsRatioByIndex,
  getEffectiveShowAs,
  buildExplorationColumns,
  getExplorationCellValue,
  type ExplorationColumn,
  type RenderOpts,
} from "@/enterprise/components/ProductAnalytics/util";
import { useDefinitions } from "@/services/DefinitionsContext";

function shouldShowTime(
  submittedExploreState: {
    dimensions?: { dimensionType?: string; dateGranularity?: string }[];
  } | null,
) {
  if (!submittedExploreState || !submittedExploreState.dimensions) return false;
  const dateDimension = submittedExploreState.dimensions.find(
    (d) => d.dimensionType === "date",
  );
  if (!dateDimension) return false;
  return dateDimension.dateGranularity === "hour";
}

/**
 * Format a raw cell value (from the shared column schema) for display in the
 * result table. The shared schema returns unformatted primitives; this adds
 * the UI-only concerns (date localization, rounding, Total fallback).
 */
function formatCellForTable(
  raw: string | number | null,
  col: ExplorationColumn,
  context: {
    submittedExploreState: {
      dimensions?: { dimensionType?: string; dateGranularity?: string }[];
    } | null;
    hasNoDimensions: boolean;
  },
): unknown {
  if (col.kind === "dimension") {
    if (raw == null || raw === "") {
      return context.hasNoDimensions ? "Total" : "";
    }
    const d = context.submittedExploreState?.dimensions?.[col.dimIndex];
    if (d?.dimensionType === "date" && typeof raw === "string") {
      const date = new Date(raw);
      let dateString = date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      if (shouldShowTime(context.submittedExploreState)) {
        dateString += ` ${date.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      }
      return dateString;
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

export default function useExplorationTableData(
  exploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig | null,
): ExplorationTableData {
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
            submittedExploreState,
            hasNoDimensions,
          }),
        ] as const;
      });
      return Object.fromEntries(entries) as Record<string, unknown>;
    });
  }, [exploration?.result?.rows, columns, renderOpts, submittedExploreState]);

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
  };
}
