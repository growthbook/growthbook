import {
  ExploreSeries,
  ExploreSeriesType,
} from "shared/enterprise";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";

// Available colors for series
export const SERIES_COLORS = [
  "#8b5cf6", // Violet
  "#3b82f6", // Blue
  "#06b6d4", // Cyan
  "#22c55e", // Green
  "#eab308", // Yellow
  "#f97316", // Orange
  "#ef4444", // Red
  "#ec4899", // Pink
  "#6b7280", // Gray
];

// Helper to generate unique IDs
let seriesIdCounter = 0;
const generateSeriesId = () => `series_${++seriesIdCounter}`;

export const createNewSeries = (type: ExploreSeriesType): ExploreSeries => {
  const baseNames: Record<ExploreSeriesType, string> = {
    metric: "Metric Series",
    factTable: "Fact Table Series",
    sql: "SQL Series",
  };

  const defaultConfigs: Record<ExploreSeriesType, ExploreSeries["config"]> = {
    metric: { factMetricId: "", metricType: "proportion" },
    factTable: { factTableId: "", valueType: "count" },
    sql: { datasourceId: "", sql: "" },
  };

  return {
    id: generateSeriesId(),
    type,
    name: baseNames[type],
    color: "", // Colors are now automatically assigned
    config: defaultConfigs[type],
  };
};

export const getSeriesLabel = (type: ExploreSeriesType) => {
  const labels: Record<ExploreSeriesType, string> = {
    metric: "Metric",
    factTable: "Fact Table",
    sql: "SQL Query",
  };
  return labels[type];
};

export const getSeriesTag = (index: number): string => {
  // A, B, C, ... Z, AA, AB, etc.
  let tag = "";
  let n = index;
  do {
    tag = String.fromCharCode(65 + (n % 26)) + tag;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return tag;
};

export function getSeriesDisplayName(
  series: ExploreSeries,
  getFactMetricById: (id: string) => FactMetricInterface | null,
  getFactTableById: (id: string) => FactTableInterface | null,
): string {
  if (series.type === "metric") {
    const config = series.config;
    if ("factMetricId" in config && config.factMetricId) {
      const factMetric = getFactMetricById(config.factMetricId);
      return factMetric?.name || series.name;
    }
  } else if (series.type === "factTable") {
    const config = series.config;
    if ("factTableId" in config && config.factTableId) {
      const factTable = getFactTableById(config.factTableId);
      const valueTypeLabel =
        config.valueType === "count"
          ? "Count"
          : config.valueType === "unit_count"
            ? `${config.unit || "Units"} Count`
            : `Sum of ${config.valueColumn || "value"}`;
      return factTable ? `${factTable.name} (${valueTypeLabel})` : series.name;
    }
  }
  return series.name;
}
