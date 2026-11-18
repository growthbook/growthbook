import type { SnapshotUpdateScope } from "shared/validators";
import type { NewMetricsUpdateWindow } from "back-end/src/services/metricRefreshPlanning";
import {
  BadRequestError,
  MetricRefreshOutsideWindowError,
  MetricRefreshUnavailableError,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";

export type UpdateScopeStep =
  | {
      action: "update_new_metrics";
      // Null when the caller asked for new metrics however old the results are.
      window: NewMetricsUpdateWindow | null;
    }
  | { action: "update_all_metrics" }
  | { action: "fail"; error: unknown };

// A new-metrics update that "auto" may replace with a normal update. Another
// running update is one: on the Incremental Pipeline the normal update then
// reports it as well, with the running snapshot's id.
function isFallbackRefusal(error: unknown): boolean {
  return (
    error instanceof MetricsAlreadyUpToDateError ||
    error instanceof MetricRefreshOutsideWindowError ||
    error instanceof MetricRefreshUnavailableError ||
    error instanceof SnapshotInProgressError
  );
}

/**
 * What a POST /experiments/:id/snapshot request runs. Called first with no
 * refusal, then, when a new-metrics update threw, again with its error.
 */
export function getUpdateScopeStep({
  updateScope = "auto",
  dimension,
  triggeredBy,
  windowHours,
  now,
  newMetricsRefusal,
}: {
  updateScope: SnapshotUpdateScope | undefined;
  dimension: string | undefined;
  triggeredBy: "manual" | "schedule" | undefined;
  windowHours: number;
  now: Date;
  newMetricsRefusal: { error: unknown } | null;
}): UpdateScopeStep {
  const otherUpdateRequested = !!dimension || triggeredBy === "schedule";
  if (updateScope === "new_metrics" && otherUpdateRequested) {
    return {
      action: "fail",
      error: new BadRequestError(
        '"updateScope": "new_metrics" can\'t be combined with "dimension" or with "triggeredBy": "schedule".',
      ),
    };
  }
  if (newMetricsRefusal) {
    return updateScope === "auto" && isFallbackRefusal(newMetricsRefusal.error)
      ? { action: "update_all_metrics" }
      : { action: "fail", error: newMetricsRefusal.error };
  }
  if (updateScope === "new_metrics") {
    return { action: "update_new_metrics", window: null };
  }
  if (
    updateScope === "all_metrics" ||
    otherUpdateRequested ||
    windowHours <= 0
  ) {
    return { action: "update_all_metrics" };
  }
  return { action: "update_new_metrics", window: { windowHours, now } };
}
