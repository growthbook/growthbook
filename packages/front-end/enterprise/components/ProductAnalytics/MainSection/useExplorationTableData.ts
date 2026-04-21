import { useMemo } from "react";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import type { HeaderStructure } from "@/components/Settings/DisplayTestQueryResults";
import { sortExplorationRows } from "@/enterprise/components/ProductAnalytics/util";

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
    values: { numerator?: number | null; denominator?: number | null }[];
  },
  metricIndex: number,
  sub: "numerator" | "denominator" | "value" | "single",
): unknown {
  const value = row.values[metricIndex];
  if (sub === "numerator") {
    return value?.numerator != null ? value.numerator : "";
  }
  if (sub === "denominator") {
    return value?.denominator != null ? value.denominator : "";
  }
  if (sub === "value" || sub === "single") {
    if (value?.numerator != null && value?.denominator != null) {
      return (value.numerator / value.denominator).toFixed(2);
    }
    if (value?.numerator != null && sub === "single") {
      const val = value.denominator
        ? value.numerator / value.denominator
        : value.numerator;
      return val.toFixed(2);
    }
    return "";
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
  },
): unknown {
  if (slot.type === "dimension") {
    return getDimensionCellValue(row, slot.dimIndex, context);
  }
  return getMetricCellValue(row, slot.metricIndex, slot.sub);
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

  const hasDenominatorAt = useMemo(() => {
    const rawRows = exploration?.result?.rows || [];
    const numValues = valueColumnHeaders.length;
    const out: boolean[] = [];
    for (let i = 0; i < numValues; i++) {
      out[i] = rawRows.some((row) => row.values[i]?.denominator != null);
    }
    return out;
  }, [exploration?.result?.rows, valueColumnHeaders.length]);

  const hasAnyDenominator = hasDenominatorAt.some(Boolean);

  const columnSchema = useMemo((): ColumnSlot[] => {
    const schema: ColumnSlot[] = [];
    dimensionColumnHeaders.forEach((label, i) => {
      schema.push({ type: "dimension", key: label, dimIndex: i });
    });
    valueColumnHeaders.forEach((name, i) => {
      if (hasDenominatorAt[i]) {
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
  }, [dimensionColumnHeaders, valueColumnHeaders, hasDenominatorAt]);

  const orderedColumnKeys = useMemo(
    () => columnSchema.map((s) => s.key),
    [columnSchema],
  );

  const headerStructure = useMemo((): HeaderStructure | null => {
    if (!hasAnyDenominator) return null;
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
  }, [hasAnyDenominator, columnSchema, valueColumnHeaders]);

  const rowData = useMemo(() => {
    const rawRows = exploration?.result?.rows || [];
    const isTimeseries =
      submittedExploreState?.dimensions?.[0]?.dimensionType === "date";

    const rowsToProcess = sortExplorationRows(rawRows, isTimeseries);

    const context = {
      dimensionColumnHeaders,
      submittedExploreState,
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
