import {
  ExperimentMetricInterface,
  isFactMetric,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import { IncrementalRefreshInterface } from "shared/validators";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { OrganizationInterface } from "shared/types/organization";
import { ExperimentInterface } from "shared/types/experiment";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import {
  getExperimentSettingsHashForIncrementalRefresh,
  getMetricSettingsHashForIncrementalRefresh,
} from "./experimentTimeSeries";

export type IncompatibleMetric = {
  id: string;
  name: string;
  reason: string;
};

// Throws if the experiment as a whole cannot use incremental refresh
// (experiment-wide gates). Per-metric incompatibilities are returned instead
// of thrown so the runner can still process the compatible subset and surface
// a non-fatal warning for the rest. Throws if no compatible metrics remain.
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
}): Promise<{ incompatibleMetrics: IncompatibleMetric[] }> {
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

  // Check if pipeline mode is set to incremental
  const settings = integration.datasource.settings;
  const canRunIncrementalRefreshQueries =
    settings.pipelineSettings?.mode === "incremental";
  if (!canRunIncrementalRefreshQueries) {
    throw new Error("Integration does not have Pipeline Incremental enabled");
  }

  if (experiment.activationMetric) {
    throw new Error(
      "Activation metrics are not supported for incremental refresh while in beta.",
    );
  }

  if (
    (settings.pipelineSettings?.includedExperimentIds !== undefined &&
      !settings.pipelineSettings?.includedExperimentIds.includes(
        experiment.id,
      )) ||
    (settings.pipelineSettings?.excludedExperimentIds !== undefined &&
      settings.pipelineSettings?.excludedExperimentIds.includes(experiment.id))
  ) {
    throw new Error(
      "Experiment is not included in the Pipeline Incremental scope",
    );
  }

  // Get selected metrics
  const selectedMetrics = snapshotSettings.metricSettings
    .map((m) => metricMap.get(m.id))
    .filter((m) => m !== undefined);

  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  const incompatibleMetrics: IncompatibleMetric[] = [];
  const hasQuantileKLL = integration.getSourceProperties().hasQuantileKLL;

  selectedMetrics.forEach((metric) => {
    if (!isFactMetric(metric)) {
      incompatibleMetrics.push({
        id: metric.id,
        name: metric.name ?? metric.id,
        reason: "only fact metrics are supported with incremental refresh",
      });
      return;
    }
    if (
      isRatioMetric(metric) &&
      metric.numerator.factTableId !== metric.denominator?.factTableId
    ) {
      incompatibleMetrics.push({
        id: metric.id,
        name: metric.name ?? metric.id,
        reason:
          "ratio metric numerator and denominator must use the same fact table for incremental refresh",
      });
      return;
    }
    // Unit quantiles store a float and re-aggregate via SUM, so they work on
    // any incremental-capable warehouse. Only event quantiles need KLL (the
    // quantile must be computed over raw event values, which requires a
    // mergeable sketch for incremental aggregation).
    if (quantileMetricType(metric) === "event" && !hasQuantileKLL) {
      incompatibleMetrics.push({
        id: metric.id,
        name: metric.name ?? metric.id,
        reason:
          "event quantile metrics require KLL sketch support, which this data source does not provide",
      });
    }
  });

  if (incompatibleMetrics.length === selectedMetrics.length) {
    throw new Error(
      `No metrics are compatible with incremental refresh: ${incompatibleMetrics[0].reason}.`,
    );
  }

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

  return { incompatibleMetrics };
}

export function formatIncompatibleMetricsWarning(
  incompatibleMetrics: IncompatibleMetric[],
): string {
  const list = incompatibleMetrics
    .map((m) => `"${m.name}" (${m.reason})`)
    .join(", ");
  return `${incompatibleMetrics.length} metric(s) excluded from incremental refresh and not computed in this snapshot: ${list}. Remove or replace these metrics, or disable incremental pipeline mode for this experiment, to compute them.`;
}
