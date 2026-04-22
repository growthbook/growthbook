import { useMemo } from "react";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
  ShowAs,
} from "shared/validators";
import type { HeaderStructure } from "@/components/Settings/DisplayTestQueryResults";
import {
  sortExplorationRows,
  getIsRatioByIndex,
  getEffectiveMetricValue,
  type RenderOpts,
} from "@/enterprise/components/ProductAnalytics/util";
import { useDefinitions } from "@/services/DefinitionsContext";

type ColumnSlot =
  | { type: "dimension"; key: string; dimIndex: number }
  | {
      type: "metric";
      key: string;
      metricIndex: number;
      sub: "numerator" | "denominator" | "value" | "single";
    };

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

function getDimensionCellValue(
  row: { dimensions: (string | null)[] },
  dimIndex: number,
  context: {
    dimensionColumnHeaders: string[];
    submittedExploreState: {
      dimensions?: { dimensionType?: string; dateGranularity?: string }[];
    } | null;
  },
): unknown {
  const dimension = row.dimensions[dimIndex];
  const { dimensionColumnHeaders, submittedExploreState } = context;
  if (dimension) {
    const currentDimension = submittedExploreState?.dimensions?.[dimIndex];
    if (currentDimension?.dimensionType === "date") {
      const d = new Date(dimension);
      let dateString = `${d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`;
      if (shouldShowTime(submittedExploreState)) {
        dateString += ` ${d.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      }
      return dateString;
    }
    return dimension;
  }
  if (dimensionColumnHeaders[0] === "Total") return "Total";
  return "";
}

function getMetricCellValue(
  row: {
    values: {
      numerator?: number | null;
      denominator?: number | null;
      metricId?: string;
    }[];
  },
  metricIndex: number,
  sub: "numerator" | "denominator" | "value" | "single",
  opts: { showAs: ShowAs; isRatio: boolean },
): unknown {
  const value = row.values[metricIndex];
  if (sub === "numerator") {
    return value?.numerator != null ? value.numerator : "";
  }
  if (sub === "denominator") {
    return value?.denominator != null ? value.denominator : "";
  }
  if (sub === "value") {
    // 3-column split's Value cell: always show numerator/denominator.
    // Only ratio metrics reach this branch.
    if (value?.numerator != null && value?.denominator != null) {
      return (value.numerator / value.denominator).toFixed(2);
    }
    return "";
  }
  if (sub === "single") {
    if (value?.numerator == null) return "";
    const v = getEffectiveMetricValue(
      { numerator: value.numerator, denominator: value.denominator ?? null },
      opts,
    );
    return v.toFixed(2);
  }
  return "";
}

function getSlotValue(
  row: {
    dimensions: (string | null)[];
    values: { numerator?: number | null; denominator?: number | null }[];
  },
  slot: ColumnSlot,
  context: {
    dimensionColumnHeaders: string[];
    submittedExploreState: { dimensions?: { dimensionType?: string }[] } | null;
    renderOpts: RenderOpts;
  },
): unknown {
  if (slot.type === "dimension") {
    return getDimensionCellValue(row, slot.dimIndex, context);
  }
  return getMetricCellValue(row, slot.metricIndex, slot.sub, {
    showAs: context.renderOpts.showAs,
    isRatio: context.renderOpts.isRatioByIndex[slot.metricIndex] ?? false,
  });
}

export interface ExplorationTableData {
  rowData: Record<string, unknown>[];
  orderedColumnKeys: string[];
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
      showAs: submittedExploreState?.showAs ?? "total",
      isRatioByIndex: getIsRatioByIndex(submittedExploreState, getFactMetricById),
    }),
    [submittedExploreState, getFactMetricById],
  );

  const dimensionColumnHeaders = useMemo(() => {
    const headers: string[] = [];
    for (const dimension of submittedExploreState?.dimensions || []) {
      if (dimension.dimensionType === "date") {
        headers.push("Date");
      } else if (dimension.dimensionType === "dynamic") {
        headers.push(dimension.column || "");
      } else {
        // Unknown dimension type — skip
      }
    }
    if (headers.length === 0) {
      headers.push("Total");
    }
    return headers;
  }, [submittedExploreState?.dimensions]);

  const valueColumnHeaders = useMemo(() => {
    return submittedExploreState?.dataset?.values.map((v) => v.name) || [];
  }, [submittedExploreState?.dataset?.values]);

  // Only ratio metrics get the 3-column Numerator/Denominator/Value split.
  // Non-ratio metrics render as a single column whose value respects `showAs`.
  const useSplitColumnsAt = useMemo(() => {
    return valueColumnHeaders.map(
      (_, i) => renderOpts.isRatioByIndex[i] ?? false,
    );
  }, [valueColumnHeaders, renderOpts.isRatioByIndex]);

  const hasAnyRatio = useSplitColumnsAt.some(Boolean);

  const columnSchema = useMemo((): ColumnSlot[] => {
    const schema: ColumnSlot[] = [];
    dimensionColumnHeaders.forEach((label, i) => {
      schema.push({ type: "dimension", key: label, dimIndex: i });
    });
    valueColumnHeaders.forEach((name, i) => {
      if (useSplitColumnsAt[i]) {
        schema.push({
          type: "metric",
          key: `${name}_Numerator`,
          metricIndex: i,
          sub: "numerator",
        });
        schema.push({
          type: "metric",
          key: `${name}_Denominator`,
          metricIndex: i,
          sub: "denominator",
        });
        schema.push({
          type: "metric",
          key: `${name}_Value`,
          metricIndex: i,
          sub: "value",
        });
      } else {
        schema.push({
          type: "metric",
          key: name,
          metricIndex: i,
          sub: "single",
        });
      }
    });
    return schema;
  }, [dimensionColumnHeaders, valueColumnHeaders, useSplitColumnsAt]);

  const orderedColumnKeys = useMemo(
    () => columnSchema.map((s) => s.key),
    [columnSchema],
  );

  const headerStructure = useMemo((): HeaderStructure | null => {
    if (!hasAnyRatio) return null;
    const row1: { label: string; colSpan?: number; rowSpan?: number }[] = [];
    const row2Labels: string[] = [];
    for (const slot of columnSchema) {
      if (slot.type === "dimension") {
        row1.push({ label: slot.key, rowSpan: 2 });
      } else {
        if (slot.sub === "numerator" || slot.sub === "single") {
          row1.push({
            label: valueColumnHeaders[slot.metricIndex],
            colSpan: slot.sub === "single" ? 1 : 3,
          });
        }
        row2Labels.push(
          slot.sub === "numerator"
            ? "Numerator"
            : slot.sub === "denominator"
              ? "Denominator"
              : "Value",
        );
      }
    }
    return { row1, row2Labels };
  }, [hasAnyRatio, columnSchema, valueColumnHeaders]);

  const rowData = useMemo(() => {
    const rawRows = exploration?.result?.rows || [];
    const isTimeseries =
      submittedExploreState?.dimensions?.[0]?.dimensionType === "date";

    const rowsToProcess = sortExplorationRows(
      rawRows,
      isTimeseries,
      renderOpts,
    );

    const context = {
      dimensionColumnHeaders,
      submittedExploreState,
      renderOpts,
    };

    return rowsToProcess.map((row) => {
      const values = columnSchema.map((slot) =>
        getSlotValue(row, slot, context),
      );
      return Object.fromEntries(
        columnSchema.map((slot, i) => [slot.key, values[i]]),
      ) as Record<string, unknown>;
    });
  }, [
    exploration?.result?.rows,
    dimensionColumnHeaders,
    columnSchema,
    submittedExploreState,
    renderOpts,
  ]);

  const explorationReturnedNoData = useMemo(() => {
    if (!exploration?.result?.rows?.length) return true;
    return exploration.result.rows.every((r) => r.values.length === 0);
  }, [exploration?.result?.rows]);

  return {
    rowData,
    orderedColumnKeys,
    headerStructure,
    explorationReturnedNoData,
  };
}
