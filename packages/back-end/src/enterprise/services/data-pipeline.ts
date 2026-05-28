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
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { getFiltersForHash } from "back-end/src/services/experimentTimeSeries";

// If the given settings / experiment is not compatible with incremental refresh, throw an error.
// Otherwise, return void.
export async function validateIncrementalPipeline({
  org,
  integration,
  snapshotSettings,
  metricMap,
  factTableMap,
  experiment,
  incrementalRefreshModel,
  analysisType,
}: {
  org: OrganizationInterface;
  integration: SourceIntegrationInterface;
  snapshotSettings: ExperimentSnapshotSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
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
  // current configuration matches what the incremental pipeline was built with.
  if (analysisType === "main-update" && incrementalRefreshModel) {
    const currentSettingsHash =
      getExperimentSettingsHashForIncrementalRefresh(snapshotSettings);
    if (
      incrementalRefreshModel.experimentSettingsHash &&
      currentSettingsHash !== incrementalRefreshModel.experimentSettingsHash
    ) {
      throw new Error(
        "The experiment configuration is outdated. Please run a Full Refresh.",
      );
    }

    // Validate metric settings hashes for existing metric sources
    if (incrementalRefreshModel.metricSources?.length) {
      const existingMetricHashMap = new Map<string, string>();
      incrementalRefreshModel.metricSources.forEach((source) => {
        source.metrics.forEach((metric) => {
          existingMetricHashMap.set(metric.id, metric.settingsHash);
        });
      });

      selectedMetrics.filter(isFactMetric).forEach((m) => {
        const storedHash = existingMetricHashMap.get(m.id);
        if (!storedHash) return;

        const currentHash = getMetricSettingsHashForIncrementalRefresh({
          factMetric: m,
          factTableMap: factTableMap,
          metricSettings: snapshotSettings.metricSettings.find(
            (ms) => ms.id === m.id,
          ),
        });

        if (currentHash !== storedHash) {
          const metricName = m.name ?? m.id;
          throw new Error(
            `The metric "${metricName}" configuration is outdated. Please run a Full Refresh.`,
          );
        }
      });
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
// to one of these MUST invalidate the metric source and force a full refresh.
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
