import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { QueryMetadata } from "shared/types/query";
import { logger } from "./logger";

// mutates metric object itself!
export function applyMetricOverrides(
  metric: ExperimentMetricInterface,
  settings: Pick<ExperimentSnapshotSettings, "metricSettings">,
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

  if (metric.regressionAdjustmentDays < 0) {
    metric.regressionAdjustmentDays = 0;
  }
  return;
}

// get the query tag string for the integration
export function getQueryTagString(
  queryMetadata: QueryMetadata,
  maxLength: number,
  encode: (value: string) => string = (value) => value,
): string {
  const metadata = {
    application: "growthbook",
    ...queryMetadata,
  };

  let tag = encode(JSON.stringify(metadata));

  if (tag.length > maxLength) {
    // delete any key that has tags and try again
    const tagKeys = Object.keys(metadata).filter((key) => key.includes("tags"));
    if (tagKeys.length > 0) {
      tag = encode(
        JSON.stringify({
          ...Object.fromEntries(
            Object.entries(metadata).filter(([key]) => !tagKeys.includes(key)),
          ),
        }),
      );
    }
  }

  // if still too long, just send the application key
  if (tag.length > maxLength) {
    logger.warn("Query tag is too long, truncating", { tag });
    tag = encode(
      JSON.stringify({
        application: "growthbook",
      }),
    );
  }
  return tag;
}
