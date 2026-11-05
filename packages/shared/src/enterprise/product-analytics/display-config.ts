import { omit, pick } from "lodash";
import {
  RENDER_ONLY_VALUE_FIELDS,
  toValueQueryKey,
} from "../../validators/product-analytics";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "../../validators/product-analytics";

/**
 * Applies the requested display settings to a cached exploration. The cache
 * match ignores them, so a cached result may still carry the settings of the
 * request that produced it.
 */
export function applyRequestedDisplayConfig(
  exploration: ProductAnalyticsExploration,
  requested: ExplorationConfig,
): ProductAnalyticsExploration {
  return {
    ...exploration,
    config: withRequestedDatasetDisplay(
      {
        ...exploration.config,
        chartType: requested.chartType,
        showAs: requested.showAs,
        chartSettings: requested.chartSettings,
        dateRange: requested.dateRange,
      },
      requested,
    ),
  };
}

/** The dataset-level and per-value display settings, by dataset type. */
function withRequestedDatasetDisplay<C extends ExplorationConfig>(
  cached: C,
  requested: ExplorationConfig,
): C {
  const cachedDataset = cached.dataset;
  const requestedDataset = requested.dataset;
  // `cached.dataset` narrows below, but the generic `C` itself doesn't.
  const withDataset = (dataset: ExplorationConfig["dataset"]) =>
    ({ ...cached, dataset }) as C;

  switch (cachedDataset.type) {
    case "funnel":
      if (requestedDataset.type !== "funnel") return cached;
      return withDataset({
        ...omit(cachedDataset, "yAxisScale"),
        ...pick(requestedDataset, "yAxisScale"),
      });
    case "journey":
      if (requestedDataset.type !== "journey") return cached;
      return withDataset({
        ...omit(cachedDataset, "heightScale"),
        ...pick(requestedDataset, "heightScale"),
      });
    case "metric":
    case "fact_table":
    case "data_source":
    case "sql":
    case "population": {
      if (requestedDataset.type !== cachedDataset.type) return cached;
      // Values match the request index for index; see `toValueQueryKey`.
      const values = cachedDataset.values.map((value, i) => ({
        ...toValueQueryKey(value),
        ...pick(requestedDataset.values[i] ?? value, RENDER_ONLY_VALUE_FIELDS),
      }));
      // `pick` types its fields as optional, though `name` is always present.
      return withDataset({
        ...cachedDataset,
        values,
      } as ExplorationConfig["dataset"]);
    }
  }
}
