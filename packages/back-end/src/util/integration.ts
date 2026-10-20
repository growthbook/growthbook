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

// Warehouse stats are often strings or missing; Number(undefined) would record NaN
export function toOptionalNumber(value: unknown): number | undefined {
  if ((value ?? null) === null) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function getWarehouseErrorCode(error: unknown): string | undefined {
  const options = [
    "data.data.queries.0.errorCode", // Snowflake
    "errors.0.reason", // BigQuery
    "errorName", // Presto / Trino
    "response.sqlState", // Databricks
    "code", // Node network errors
    "sqlState", // Node network errors
    "errorCode", // Databricks generic fallback
  ];

  const isRecord = (obj: unknown): obj is Record<string, unknown> =>
    !!obj && typeof obj === "object";

  for (const option of options) {
    const value = option.split(".").reduce((obj: unknown, key) => {
      if (key === "0") return Array.isArray(obj) ? obj[0] : undefined;
      return isRecord(obj) ? obj[key] : undefined;
    }, error);
    if (typeof value === "number" && value !== -1) return String(value);
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

// get the query tag string for the integration
export function getQueryTagString(
  queryMetadata: QueryMetadata,
  maxLength: number,
): string {
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
