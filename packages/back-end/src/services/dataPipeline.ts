import {
  ExperimentMetricInterface,
  isFactMetric,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import { IncrementalRefreshInterface } from "shared/src/validators/incremental-refresh";
import { ExperimentSnapshotSettings } from "back-end/types/experiment-snapshot";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { OrganizationInterface } from "back-end/types/organization";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { ExperimentInterface } from "back-end/types/experiment";
import {
  getExperimentSettingsHashForIncrementalRefresh,
  getMetricSettingsHashForIncrementalRefresh,
} from "./experimentTimeSeries";

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
  if (selectedMetrics.some((m) => !isFactMetric(m))) {
    throw new Error(
      "Only fact metrics are supported with incremental refresh.",
    );
  }

  selectedMetrics.filter(isFactMetric).forEach((metric) => {
    if (
      isRatioMetric(metric) &&
      metric.numerator.factTableId !== metric.denominator?.factTableId
    ) {
      throw new Error(
        "Ratio metrics must have the same numerator and denominator fact table with incremental refresh.",
      );
    }

    if (quantileMetricType(metric)) {
      throw new Error(
        "Quantile metrics are not supported with incremental refresh.",
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
