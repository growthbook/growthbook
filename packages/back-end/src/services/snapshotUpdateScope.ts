import type { ExperimentInterface } from "shared/types/experiment";
import type { DataSourceInterface } from "shared/types/datasource";
import type { SnapshotUpdateScope } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type { NewMetricsUpdateWindow } from "back-end/src/services/metricRefreshPlanning";
import { createExperimentSnapshot } from "back-end/src/services/experiments";
import {
  BadRequestError,
  MetricRefreshOutsideWindowError,
  MetricRefreshUnavailableError,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";

// Which metrics an update computes, once the request has been read.
export type ResolvedUpdateScope =
  | { kind: "all_metrics" }
  | {
      kind: "new_metrics";
      // Null when the caller asked for new metrics however old the results are.
      window: NewMetricsUpdateWindow | null;
      // "fallback" runs a normal update when the new-metrics update is refused.
      onRefusal: "fallback" | "fail";
    };

export type RanUpdateScope = ResolvedUpdateScope["kind"];

type SnapshotResult = Awaited<ReturnType<typeof createExperimentSnapshot>>;

/**
 * Maps the REST "updateScope" field. "auto" computes only new metrics inside
 * the org's window and falls back to a normal update; it never applies to a
 * breakdown or a scheduled update.
 */
export function resolveApiUpdateScope({
  updateScope = "auto",
  dimension,
  triggeredBy,
  windowHours,
  now,
}: {
  updateScope: SnapshotUpdateScope | undefined;
  dimension: string | undefined;
  triggeredBy: "manual" | "schedule" | undefined;
  windowHours: number;
  now: Date;
}): ResolvedUpdateScope {
  const otherUpdateRequested = !!dimension || triggeredBy === "schedule";
  if (updateScope === "new_metrics") {
    if (otherUpdateRequested) {
      throw new BadRequestError(
        '"updateScope": "new_metrics" can\'t be combined with "dimension" or with "triggeredBy": "schedule".',
      );
    }
    return { kind: "new_metrics", window: null, onRefusal: "fail" };
  }
  if (
    updateScope === "all_metrics" ||
    otherUpdateRequested ||
    windowHours <= 0
  ) {
    return { kind: "all_metrics" };
  }
  return {
    kind: "new_metrics",
    window: { windowHours, now },
    onRefusal: "fallback",
  };
}

// Refusals a fallback replaces with a normal update. Another running update is
// one: on the Incremental Pipeline the normal update then reports it as well,
// with the running snapshot's id.
function isFallbackRefusal(error: unknown): boolean {
  return (
    error instanceof MetricsAlreadyUpToDateError ||
    error instanceof MetricRefreshOutsideWindowError ||
    error instanceof MetricRefreshUnavailableError ||
    error instanceof SnapshotInProgressError
  );
}

/**
 * Starts the update `scope` asks for. A new-metrics update builds on the
 * phase's latest Overall Results; `updateAllMetrics` runs the caller's normal
 * update, also as the fallback.
 */
export async function createScopedExperimentSnapshot({
  scope,
  context,
  experiment,
  datasource,
  phase,
  updateAllMetrics,
}: {
  scope: ResolvedUpdateScope;
  context: ReqContext;
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  phase: number;
  updateAllMetrics: () => Promise<SnapshotResult>;
}): Promise<SnapshotResult & { updateScope: RanUpdateScope }> {
  if (scope.kind === "new_metrics") {
    try {
      const result = await createExperimentSnapshot({
        context,
        experiment,
        datasource,
        phase,
        dimension: undefined,
        useCache: true,
        updateScope: scope,
      });
      return { ...result, updateScope: "new_metrics" };
    } catch (error) {
      if (scope.onRefusal === "fail" || !isFallbackRefusal(error)) throw error;
    }
  }
  return { ...(await updateAllMetrics()), updateScope: "all_metrics" };
}
