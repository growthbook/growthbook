import { findAnalysisComputeFailure, getSnapshotAnalysis } from "shared/util";
import type { QueryRunnerFailureCause } from "shared/types/query";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import type { Context } from "back-end/src/models/BaseModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { notifyExperimentUpdateFailed } from "back-end/src/services/experimentNotifications";
import { logger } from "back-end/src/util/logger";

export async function notifySnapshotUpdateFailure({
  context,
  snapshot,
  failureCause = "query",
}: {
  context: Context;
  snapshot: ExperimentSnapshotInterface;
  failureCause?: QueryRunnerFailureCause;
}): Promise<void> {
  if (
    snapshot.type !== "standard" ||
    snapshot.report ||
    failureCause === "cancelled"
  )
    return;
  const computeFailed =
    snapshot.status === "success" &&
    findAnalysisComputeFailure(getSnapshotAnalysis(snapshot)) !== null;
  if (snapshot.status !== "error" && !computeFailed) return;

  try {
    const experiment = await getExperimentById(context, snapshot.experiment);
    // Mirror the success path: a snapshot for an older phase says nothing
    // about the current phase, and alerting on it would also set the failure
    // marker that only a latest-phase success can clear.
    if (!experiment || snapshot.phase !== experiment.phases.length - 1) return;
    await notifyExperimentUpdateFailed({
      context,
      experiment,
      cause: computeFailed ? "analysis" : failureCause,
    });
  } catch (error) {
    logger.error(error, "Failed to notify experiment update failure");
  }
}
