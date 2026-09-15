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
    if (!experiment) return;
    await notifyExperimentUpdateFailed({
      context,
      experiment,
      cause: computeFailed ? "analysis" : failureCause,
    });
  } catch (error) {
    logger.error(error, "Failed to notify experiment update failure");
  }
}
