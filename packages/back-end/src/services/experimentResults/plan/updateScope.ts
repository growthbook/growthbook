import {
  isWithinNewMetricsUpdateWindow,
  type NewMetricsUpdateWindow,
} from "shared/experiments";
import type { ExperimentInterface } from "shared/types/experiment";
import type { DataSourceInterface } from "shared/types/datasource";
import type { SnapshotUpdateScope } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import { findLatestSuccessfulSnapshotEndDate } from "back-end/src/models/ExperimentSnapshotModel";
import { createExperimentSnapshot } from "back-end/src/services/experiments";
import {
  BadRequestError,
  NewMetricsUpdateUnavailableError,
  MetricsAlreadyUpToDateError,
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

// Refusals a fallback replaces with a normal update. A running update is not
// one: a second update of every metric beside it would cost more than waiting.
function isFallbackRefusal(error: unknown): boolean {
  return (
    error instanceof MetricsAlreadyUpToDateError ||
    error instanceof NewMetricsUpdateUnavailableError
  );
}

// The window is counted from the end date of the latest Overall Results, the
// parent the planner loads, before anything is planned. Without results the
// new-metrics update would be refused anyway.
async function latestResultsAreInWindow({
  context,
  experiment,
  phase,
  window,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  phase: number;
  window: NewMetricsUpdateWindow;
}): Promise<boolean> {
  const resultsEndDate = await findLatestSuccessfulSnapshotEndDate(context, {
    experiment: experiment.id,
    phase,
  });
  return (
    !!resultsEndDate &&
    isWithinNewMetricsUpdateWindow({ ...window, resultsEndDate })
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
  if (
    scope.kind === "new_metrics" &&
    (!scope.window ||
      (await latestResultsAreInWindow({
        context,
        experiment,
        phase,
        window: scope.window,
      })))
  ) {
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
