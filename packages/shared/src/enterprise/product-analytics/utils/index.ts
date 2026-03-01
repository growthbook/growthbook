import type { ProductAnalyticsConfig } from "../../../validators/product-analytics";

/** Default product analytics config used for new blocks and Explorer initial state. */
export const DEFAULT_EXPLORE_STATE: ProductAnalyticsConfig = {
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
): ProductAnalyticsConfig {
  switch (blockType) {
    case "metric-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        datasource: datasourceId,
      };
    case "fact-table-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
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
