import type { ExplorationConfig } from "../../../validators/product-analytics";

/** Default product analytics config used for new blocks and Explorer initial state. */
export const DEFAULT_EXPLORE_STATE: ExplorationConfig = {
  type: "metric",
  dataset: {
    type: "metric",
    values: [],
  },
  datasource: "",
  dimensions: [
    {
      dimensionType: "date",
      column: "date",
      dateGranularity: "auto",
    },
  ],
  chartType: "line",
  dateRange: {
    predefined: "last30Days",
    lookbackValue: 30,
    lookbackUnit: "day",
    startDate: null,
    endDate: null,
  },
};

export type ProductAnalyticsExplorationBlockType =
  | "metric-exploration"
  | "fact-table-exploration"
  | "data-source-exploration";

export function getInitialConfigByBlockType(
  blockType: ProductAnalyticsExplorationBlockType,
  datasourceId: string,
): ExplorationConfig {
  switch (blockType) {
    case "metric-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        datasource: datasourceId,
      };
    case "fact-table-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        type: "fact_table",
        dataset: {
          type: "fact_table",
          values: [],
          factTableId: null,
        },
        datasource: datasourceId,
      };
    case "data-source-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        type: "data_source",
        dataset: {
          type: "data_source",
          values: [],
          table: "",
          path: "",
          timestampColumn: "",
          columnTypes: {},
        },
        datasource: datasourceId,
      };
    default:
      throw new Error(`Invalid block type: ${blockType}`);
  }
}

export function encodeExplorationConfig(config: ExplorationConfig): string {
  return btoa(encodeURIComponent(JSON.stringify(config)));
}
