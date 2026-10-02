import { z } from "zod";
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

// Where each client library puts its error code, checked in priority order
const warehouseErrorValidator = z.object({
  // BigQuery (`code` is just the HTTP status)
  errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  // Presto / Trino
  errorName: z.string().optional(),
  // Databricks
  response: z.object({ sqlState: z.string().nullish() }).optional(),
  // Snowflake, Postgres, Redshift, MySQL, ClickHouse, Athena, Node network errors
  code: z.union([z.string(), z.number()]).optional(),
  sqlState: z.string().optional(),
  // Databricks fallback (ERROR / CANCELED / TIMEOUT)
  errorCode: z.union([z.string(), z.number()]).optional(),
});

// The warehouse's own error code, for grouping failures more reliably than by message
export function getWarehouseErrorCode(error: unknown): string | undefined {
  const parsed = warehouseErrorValidator.safeParse(error);
  if (!parsed.success) return undefined;
  const e = parsed.data;
  const code =
    e.errors?.[0]?.reason ??
    e.errorName ??
    e.response?.sqlState ??
    e.code ??
    e.sqlState ??
    e.errorCode;
  return (code ?? "") === "" ? undefined : String(code);
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
