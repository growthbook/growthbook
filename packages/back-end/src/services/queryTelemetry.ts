import type { DataSourceInterface } from "shared/types/datasource";
import type { QueryInterface } from "shared/types/query";
import type { ReqContext } from "back-end/types/request";
import {
  trackEventForContext,
  trackEventForOrganizationId,
} from "back-end/src/services/growthbook";
import { logger } from "back-end/src/util/logger";

// GrowthBook-defined causes only; raw warehouse messages can echo customer
// data, so they are never sent.
export type QueryErrorType =
  | "warehouse-error"
  | "result-processing-error"
  | "dependency-failed"
  | "missing-run-callbacks"
  | "runner-concluded"
  | "stale-heartbeat"
  | "orphaned";

type QueryTelemetrySource = {
  query: Pick<QueryInterface, "id"> &
    Partial<Pick<QueryInterface, "queryType" | "datasource">>;
  // null when the caller has no integration loaded (e.g. cross-org reapers)
  datasource: Pick<DataSourceInterface, "id" | "type"> | null;
  durationMs: number | null;
};

function getQueryEventProperties({
  query,
  datasource,
  durationMs,
}: QueryTelemetrySource) {
  return {
    queryId: query.id,
    queryType: query.queryType || "unknown",
    datasourceId: datasource?.id ?? query.datasource ?? null,
    datasourceType: datasource?.type ?? null,
    durationMs,
  };
}

// All helpers are fire and forget: telemetry must never fail or delay a query.
export function trackQuerySucceeded(
  context: ReqContext,
  source: QueryTelemetrySource,
): void {
  try {
    trackEventForContext(
      context,
      "Query Succeeded",
      getQueryEventProperties(source),
    );
  } catch (e) {
    logger.warn({ err: e }, "Failed to track query success");
  }
}

export function trackQueryFailed(
  context: ReqContext,
  source: QueryTelemetrySource,
  errorType: QueryErrorType,
): void {
  try {
    trackEventForContext(context, "Query Failed", {
      ...getQueryEventProperties(source),
      errorType,
    });
  } catch (e) {
    logger.warn({ err: e }, "Failed to track query failure");
  }
}

export function trackQueryFailedForOrganizationId(
  organizationId: string,
  source: QueryTelemetrySource,
  errorType: QueryErrorType,
): void {
  try {
    trackEventForOrganizationId(organizationId, "Query Failed", {
      ...getQueryEventProperties(source),
      errorType,
    });
  } catch (e) {
    logger.warn({ err: e }, "Failed to track query failure");
  }
}
