import {
  datasetHasValues,
  withRequestedRenderFields,
} from "../../../validators/product-analytics";
import { projectJourneyRows } from "../../../journeys";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "../../../validators/product-analytics";

/** A cached config whose values carry the requested values' render-only fields. */
function withRequestedValues<C extends ExplorationConfig>(
  cached: C,
  requested: ExplorationConfig,
): C {
  const { dataset } = cached;
  const requestedDataset = requested.dataset;
  if (!datasetHasValues(dataset) || !datasetHasValues(requestedDataset)) {
    return cached;
  }
  return {
    ...cached,
    dataset: {
      ...dataset,
      values: dataset.values.map((value, i) =>
        requestedDataset.values[i]
          ? withRequestedRenderFields(value, requestedDataset.values[i])
          : value,
      ),
    },
  };
}

/**
 * Cache lookup keys off query-defining fields (see
 * AnalyticsExplorationModel.getConfigHashes) and can reuse compatible date
 * ranges. Serve the cached rows with the requested display config. Journeys
 * also take the requested path and collapse cached lookahead to the display
 * frontier.
 */
export function withRequestedDisplayConfig(
  exploration: ProductAnalyticsExploration,
  requested: ExplorationConfig,
): ProductAnalyticsExploration {
  if (
    exploration.config.type === "sql" &&
    requested.type === "sql" &&
    requested.chartType === "rawTable"
  ) {
    return {
      ...exploration,
      config: {
        ...exploration.config,
        chartType: requested.chartType,
        dateRange: requested.dateRange,
        dataset: {
          ...exploration.config.dataset,
          hiddenColumns: requested.dataset.hiddenColumns,
        },
      },
    };
  }
  const config = {
    ...exploration.config,
    chartType: requested.chartType,
    showAs: requested.showAs,
    chartSettings: requested.chartSettings,
    dateRange: requested.dateRange,
  };
  if (config.type !== "journey" || requested.type !== "journey") {
    return { ...exploration, config: withRequestedValues(config, requested) };
  }
  const rows = projectJourneyRows({
    cachedDataset: config.dataset,
    cachedRows: exploration.result?.rows ?? [],
    requestedDataset: requested.dataset,
  });
  return {
    ...exploration,
    config: {
      ...config,
      dataset: {
        ...config.dataset,
        path: requested.dataset.path,
        optionsPerStep: requested.dataset.optionsPerStep,
      },
    },
    result: { ...(exploration.result ?? { rows: [] }), rows },
  };
}
