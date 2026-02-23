import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { logger } from "./logger";
import { QueryMetadata } from "shared/types/query";

// mutates metric object itself!
export function applyMetricOverrides(
  metric: ExperimentMetricInterface,
  settings: ExperimentSnapshotSettings,
): void {
  if (!metric) return;

  const computed = settings.metricSettings.find(
    (s) => s.id === metric.id,
  )?.computedSettings;
  if (!computed) return;

  metric.windowSettings = computed.windowSettings;
  metric.regressionAdjustmentEnabled = computed.regressionAdjustmentEnabled;
  metric.regressionAdjustmentDays = computed.regressionAdjustmentDays;

  metric.priorSettings.proper = computed.properPrior;
  metric.priorSettings.mean = computed.properPriorMean;
  metric.priorSettings.stddev = computed.properPriorStdDev;

  metric.targetMDE = computed.targetMDE ?? undefined;

  // TODO: move this to the form validation when saving this settings
  if (metric.regressionAdjustmentDays < 0) {
    metric.regressionAdjustmentDays = 0;
  }
  if (metric.regressionAdjustmentDays > 100) {
    metric.regressionAdjustmentDays = 100;
  }
  return;
}

// get the query tag string for the integration
export function getQueryTagString(queryMetadata: QueryMetadata, maxLength: number): string {
  const metadata = {
    application: "growthbook",
    ...queryMetadata,
  };
  
  let json = JSON.stringify(metadata);

  if (json.length > maxLength) {
    // delete any key that has tags and try again
    const tagKeys = Object.keys(metadata).filter((key) => key.includes("tags"));
    if (tagKeys.length > 0) {
      json = JSON.stringify({
        ...Object.fromEntries(
          Object.entries(metadata).filter(([key]) => !tagKeys.includes(key)),
        ),
      });
    }
  }

  // if still too long, just send the application key
  if (json.length > maxLength) {
    logger.warn("Query tag is too long, truncating", { json });
    json = JSON.stringify({
      application: "growthbook",
    });
  }
  return json;
}