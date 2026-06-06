import md5 from "md5";
import {
  ExperimentMetricInterface,
  isFactMetric,
  quantileMetricType,
} from "shared/experiments";
import { isExperimentIncrementalEnabled } from "shared/enterprise";
import { IncrementalRefreshInterface } from "shared/validators";
import {
  ExperimentSnapshotSettings,
  MetricForSnapshot,
} from "shared/types/experiment-snapshot";
import { OrganizationInterface } from "shared/types/organization";
import { ExperimentInterface } from "shared/types/experiment";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { getFiltersForHash } from "back-end/src/services/experimentTimeSeries";
import type { MetricFanOut } from "back-end/src/services/experimentQueries/planMetricFanOut";

/**
 * Preconditions for running the incremental refresh query runner on a snapshot.
 * Throws when incremental refresh is unsupported for this configuration, or when
 * an incremental update would reuse a units table built under different
 * experiment-level settings.
 *
 * Does not validate metric-source cache drift. See getFactTablesNeedingRebuild.
 */
export async function assertIncrementalRefreshPrerequisites({
  org,
  integration,
  snapshotSettings,
  metricMap,
  experiment,
  incrementalRefreshModel,
  analysisType,
}: {
  org: OrganizationInterface;
  integration: SourceIntegrationInterface;
  snapshotSettings: ExperimentSnapshotSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  experiment: ExperimentInterface;
  incrementalRefreshModel: IncrementalRefreshInterface | null;
  analysisType: "main-update" | "main-fullRefresh" | "exploratory";
}): Promise<void> {
  if (snapshotSettings.skipPartialData) {
    throw new Error(
      "'Exclude In-Progress Conversions' is not supported for incremental refresh queries while in beta. Please select 'Include' in the Analysis Settings for Metric Conversion Windows.",
    );
  }

  if (!integration.getSourceProperties().hasIncrementalRefresh) {
    throw new Error("Integration does not support incremental refresh queries");
  }

  // Check if organization has the incremental refresh feature
  const hasIncrementalRefreshFeature = orgHasPremiumFeature(
    org,
    "incremental-refresh",
  );
  if (!hasIncrementalRefreshFeature) {
    throw new Error(
      "Organization does not have access to incremental refresh feature",
    );
  }

  const settings = integration.datasource.settings;
  if (
    !isExperimentIncrementalEnabled(settings.pipelineSettings, experiment.id)
  ) {
    throw new Error(
      "This experiment is not enabled for incremental refresh on this data source.",
    );
  }

  if (experiment.activationMetric) {
    throw new Error(
      "Activation metrics are not supported for incremental refresh while in beta.",
    );
  }

  // Get selected metrics
  const selectedMetrics = snapshotSettings.metricSettings
    .map((m) => metricMap.get(m.id))
    .filter((m) => m !== undefined);

  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }
  if (selectedMetrics.some((m) => !isFactMetric(m))) {
    throw new Error(
      "Only fact metrics are supported with incremental refresh.",
    );
  }

  selectedMetrics.filter(isFactMetric).forEach((metric) => {
    // Unit quantiles store a float and re-aggregate via SUM, so they work on
    // any incremental-capable warehouse. Only event quantiles need a quantile
    // sketch (the quantile must be computed over raw event values, which
    // requires a mergeable sketch for incremental aggregation).
    if (
      quantileMetricType(metric) === "event" &&
      !integration.getSourceProperties().hasQuantileSketch
    ) {
      throw new Error(
        "Event quantile metrics are not supported with incremental refresh on this data source.",
      );
    }
  });

  // If not forcing a full refresh and we have a previous run, ensure the
  // experiment-level configuration matches what the incremental pipeline was
  // built with. Experiment-level changes (attribution model, exposure query,
  // segment, query filter, start date, regression-adjustment toggle) reshape
  // the units table and everything downstream, so they require a full refresh.
  //
  // Per-metric settings changes are intentionally NOT validated here. A changed
  // metric is recoverable without a full refresh: the incremental runner
  // detects the metric-source hash drift (see getFactTablesNeedingRebuild) and
  // rebuilds only that metric's fact-table cache, leaving the units table and
  // every unaffected metric cache on the incremental path.
  if (analysisType === "main-update" && incrementalRefreshModel) {
    const currentSettingsHash =
      getExperimentSettingsHashForIncrementalRefresh(snapshotSettings);
    const storedSettingsHash = incrementalRefreshModel.experimentSettingsHash;
    if (storedSettingsHash && currentSettingsHash !== storedSettingsHash) {
      throw new Error(
        "The experiment configuration is outdated. Please run a Full Refresh.",
      );
    }
  }
}

const hashObject = (obj: object) => md5(JSON.stringify(obj));

export function getExperimentSettingsHashForIncrementalRefresh(
  snapshotSettings: ExperimentSnapshotSettings,
): string {
  return hashObject({
    // snapshotSettings
    activationMetric: snapshotSettings.activationMetric,
    attributionModel: snapshotSettings.attributionModel,
    queryFilter: snapshotSettings.queryFilter,
    segment: snapshotSettings.segment,
    skipPartialData: snapshotSettings.skipPartialData,
    datasourceId: snapshotSettings.datasourceId,
    exposureQueryId: snapshotSettings.exposureQueryId,
    startDate: snapshotSettings.startDate,
    regressionAdjustmentEnabled: snapshotSettings.regressionAdjustmentEnabled,
    experimentId: snapshotSettings.experimentId,
  });
}

type ComputedSettingsForSnapshot = NonNullable<
  MetricForSnapshot["computedSettings"]
>;

// Fields of `MetricForSnapshot.computedSettings` whose values change the
// queries we run or the data they return for incremental refresh. Any change
// to one of these triggers a per-fact-table cache rebuild via
// getFactTablesNeedingRebuild (not a full experiment refresh).
const HASHED_COMPUTED_SETTINGS_FIELDS_FOR_INCREMENTAL_REFRESH = [
  "regressionAdjustmentEnabled",
  "regressionAdjustmentDays",
  "windowSettings",
] as const satisfies readonly (keyof ComputedSettingsForSnapshot)[];

// Fields of `MetricForSnapshot.computedSettings` that are intentionally NOT
// part of the incremental-refresh hash because they only affect analysis-time
// interpretation, not the SQL we generate. Spurious changes to these (e.g.
// `regressionAdjustmentReason` flipping between different free-text strings)
// must not trigger a full refresh.
type IgnoredComputedSettingsFieldForIncrementalRefresh =
  | "regressionAdjustmentAvailable"
  | "regressionAdjustmentReason"
  | "properPrior"
  | "properPriorMean"
  | "properPriorStdDev"
  | "targetMDE";

// Compile-time exhaustiveness guard. When a field is added to
// `MetricForSnapshot.computedSettings`, this resolves to that field's literal
// type instead of `never`, and the `AssertNever` constraint below fails to
// compile. Classify the new field in the hashed array or ignored union above
// to fix it.
type AssertNever<T extends never> = T;
type UnhandledComputedSettingsFieldForIncrementalRefresh = Exclude<
  keyof ComputedSettingsForSnapshot,
  | (typeof HASHED_COMPUTED_SETTINGS_FIELDS_FOR_INCREMENTAL_REFRESH)[number]
  | IgnoredComputedSettingsFieldForIncrementalRefresh
>;
export type ComputedSettingsForIncrementalRefreshExhaustivenessCheck =
  AssertNever<UnhandledComputedSettingsFieldForIncrementalRefresh>;

export function getMetricSettingsHashForIncrementalRefresh({
  factMetric,
  factTableMap,
  metricSettings,
}: {
  factMetric: FactMetricInterface;
  factTableMap: Map<string, FactTableInterface>;
  metricSettings?: MetricForSnapshot;
}): string {
  const numeratorFactTableId = factMetric.numerator.factTableId;
  const numeratorFactTable = numeratorFactTableId
    ? factTableMap?.get(numeratorFactTableId)
    : undefined;

  const denominatorFactTableId = factMetric.denominator?.factTableId;
  const denominatorFactTable = denominatorFactTableId
    ? factTableMap?.get(denominatorFactTableId)
    : undefined;

  const computedSettings = metricSettings?.computedSettings;
  const hashedComputedSettings: Partial<ComputedSettingsForSnapshot> =
    computedSettings
      ? Object.fromEntries(
          HASHED_COMPUTED_SETTINGS_FIELDS_FOR_INCREMENTAL_REFRESH.map(
            (field) => [field, computedSettings[field]],
          ),
        )
      : {};

  return hashObject({
    ...hashedComputedSettings,
    metricType: factMetric.metricType,
    numerator: factMetric.numerator,
    denominator: factMetric.denominator,
    cappingSettings: factMetric.cappingSettings,
    quantileSettings: factMetric.quantileSettings,
    numeratorFactTable: {
      sql: numeratorFactTable?.sql,
      eventName: numeratorFactTable?.eventName,
      filters: getFiltersForHash(numeratorFactTable, factMetric.numerator),
    },
    denominatorFactTable: {
      sql: denominatorFactTable?.sql,
      eventName: denominatorFactTable?.eventName,
      // filters should be added here as well in case it is a cross
      // fact table ratio metric
      filters: getFiltersForHash(denominatorFactTable, factMetric.denominator),
    },
  });
}

/**
 * Compares the persisted incremental-refresh cache state against the desired
 * metric fan-out and the current per-metric settings hashes, returning the set
 * of fact tables whose cache tables must be rebuilt from scratch (CREATE +
 * full INSERT) instead of incrementally appended.
 *
 * A fact table needs a rebuild when any of these drift from the persisted cache:
 *   - A metric now maps to it that the cache doesn't hold yet (added metric).
 *   - The cache holds a (factTableId, metricId) tuple that's no longer desired
 *     (removed metric, or a cross-FT ratio side that moved to the other FT).
 *   - A metric still maps to it but its `settingsHash` changed — the cache's
 *     schema/values are out of shape with the metric's new configuration
 *     (conversion window, column refs, fact-table SQL/filters, CUPED days, …).
 *
 * The settings-hash case is what lets a changed metric recover incrementally:
 * only that metric's fact-table cache is rebuilt, while the units table and
 * every unaffected metric cache stay on the incremental path. Cross-FT ratio
 * metrics carry the same `settingsHash` in both of their fact tables' caches,
 * so a settings change flags both sides. Experiment-level setting changes are
 * out of scope — they force a full refresh upstream in
 * `assertIncrementalRefreshPrerequisites`.
 */
export function getFactTablesNeedingRebuild({
  existingMetricSources,
  desiredFanOut,
  currentMetricSettingsHashes,
}: {
  existingMetricSources: IncrementalRefreshInterface["metricSources"];
  desiredFanOut: MetricFanOut;
  currentMetricSettingsHashes: Map<string, string>;
}): Set<string> {
  const factTablesToRebuild = new Set<string>();
  if (!existingMetricSources.length) return factTablesToRebuild;

  // (factTableId, metricId) tuples the persisted caches currently hold.
  const storedTuples = new Set<string>();
  existingMetricSources.forEach((source) => {
    source.metrics.forEach((m) => {
      storedTuples.add(`${source.factTableId}|${m.id}`);
    });
  });

  // Added tuples: a metric now maps to an FT whose cache doesn't hold it yet.
  // Growing the cache changes its schema, so rebuild it.
  const desiredTuples = new Set<string>();
  desiredFanOut.perFt.forEach(({ factTableId, metrics }) => {
    metrics.forEach((metric) => {
      const tuple = `${factTableId}|${metric.id}`;
      desiredTuples.add(tuple);
      if (!storedTuples.has(tuple)) {
        factTablesToRebuild.add(factTableId);
      }
    });
  });

  existingMetricSources.forEach((source) => {
    source.metrics.forEach((m) => {
      // Orphaned tuple: the cache holds a metric (or a cross-FT ratio side)
      // that's no longer desired. Rebuild so the schema sheds the dead column.
      if (!desiredTuples.has(`${source.factTableId}|${m.id}`)) {
        factTablesToRebuild.add(source.factTableId);
        return;
      }
      // Settings drift: the metric still maps here but its configuration
      // changed since the cache was built. Recompute the cache from scratch so
      // the persisted values reflect the new settings.
      const currentHash = currentMetricSettingsHashes.get(m.id);
      if (currentHash !== m.settingsHash) {
        factTablesToRebuild.add(source.factTableId);
      }
    });
  });

  return factTablesToRebuild;
}
