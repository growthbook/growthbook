import { z } from "zod";
import { getNewMetricsUpdate } from "shared/experiments";
import { apiExperimentSnapshotValidator } from "shared/validators";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";

export function toApiExperimentSnapshot(
  snapshot: ExperimentSnapshotInterface,
): z.infer<typeof apiExperimentSnapshotValidator> {
  return {
    id: snapshot.id,
    experiment: snapshot.experiment,
    status: snapshot.status,
    ...(snapshot.status === "error" && snapshot.error
      ? { error: snapshot.error }
      : {}),
    updateScope: getNewMetricsUpdate(snapshot) ? "new_metrics" : "all_metrics",
  };
}
