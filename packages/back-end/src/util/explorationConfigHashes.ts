import md5 from "md5";
import type { ExplorationConfig, PopulationInterface } from "shared/validators";
import { omitRenderOnlyFields } from "shared/validators";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
  getPopulationCacheKey,
} from "shared/enterprise";
import { journeyFamilyIdentity } from "shared/journeys";

/**
 * `savedPopulation` is the saved Population behind a metric dataset's
 * `population`. Required when the config has one: the cache is keyed on its
 * definition, so edits to it invalidate cached results and Populations with
 * the same definition share them. `metricVersions` maps each saved metric
 * id to its `dateUpdated`, so editing a metric invalidates cached results.
 */
export function getExplorationConfigHashes(
  config: ExplorationConfig,
  savedPopulation: Pick<PopulationInterface, "steps"> | null = null,
  metricVersions: Map<string, Date> | null = null,
) {
  const dataset = config.dataset;
  if (!dataset) return null;

  let populationKey: object | null = null;
  if (dataset.type === "metric" && dataset.population) {
    if (!savedPopulation) {
      throw new Error("The exploration's saved Population is required");
    }
    populationKey = getPopulationCacheKey(
      savedPopulation,
      dataset.population.unit,
    );
  }

  const dateRange = calculateProductAnalyticsDateRange(config.dateRange);

  const dimensions = config.dimensions.map((dimension) => {
    if (dimension.dimensionType === "date") {
      // Evaluate "auto" granularity for higher cache hit rates
      return {
        ...dimension,
        dateGranularity: getDateGranularity(
          dimension.dateGranularity,
          dateRange,
        ),
      };
    }
    return dimension;
  });

  // General settings hash
  const generalSettingsHash = md5(
    JSON.stringify({
      type: config.type,
      datasource: config.datasource,
      dimensions: dimensions,
      factTableId: dataset.type === "fact_table" ? dataset.factTableId : null,
      table: dataset.type === "data_source" ? dataset.table : null,
      path: dataset.type === "data_source" ? dataset.path : null,
      sql: dataset.type === "sql" ? dataset.sql : null,
      rawTable: config.chartType === "rawTable",
      ...(populationKey ? { population: populationKey } : {}),
      timestampColumn:
        dataset.type === "data_source" || dataset.type === "sql"
          ? dataset.timestampColumn
          : null,
      // Funnel-specific keys: unit and concurrency window affect query
      // results but live at the dataset level rather than per-step.
      funnelUnit: dataset.type === "funnel" ? dataset.unit : null,
      funnelConcurrencyWindowSeconds:
        dataset.type === "funnel"
          ? (dataset.concurrencyWindowSeconds ?? 0)
          : null,
      // Omitted (not null) for other types so pre-existing cache hashes
      // stay valid.
      ...(dataset.type === "journey"
        ? { journeyFamily: journeyFamilyIdentity(dataset) }
        : {}),
    }),
  );

  // Value hashes. Funnels treat the whole steps array as one logical
  // "value" (decision in the funnels plan): a single hash invalidates
  // the cache on any step change. Per-step incremental refresh is a
  // future optimization.
  const valueHashes =
    dataset.type === "funnel"
      ? [md5(JSON.stringify(dataset.steps))]
      : dataset.type === "journey"
        ? [md5("journey")]
        : config.chartType === "rawTable"
          ? []
          : dataset.values.map((value) => {
              const metricUpdated =
                "metricId" in value
                  ? metricVersions?.get(value.metricId)
                  : undefined;
              return md5(
                JSON.stringify({
                  ...omitRenderOnlyFields(value),
                  ...(metricUpdated ? { metricUpdated } : {}),
                }),
              );
            });

  return {
    generalSettingsHash,
    valueHashes,
  };
}
