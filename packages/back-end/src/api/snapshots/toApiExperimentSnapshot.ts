import { z } from "zod";
import { getMetricRefresh } from "shared/experiments";
import { apiExperimentSnapshotValidator } from "shared/validators";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";

export function toApiExperimentSnapshot(
  snapshot: ExperimentSnapshotInterface,
): z.infer<typeof apiExperimentSnapshotValidator> {
  const metricRefresh = getMetricRefresh(snapshot);
  return {
    id: snapshot.id,
    experiment: snapshot.experiment,
    status: snapshot.status,
    ...(snapshot.status === "error" && snapshot.error
      ? { error: snapshot.error }
      : {}),
    ...(metricRefresh
      ? {
          metricRefresh: {
            baseSnapshotId: metricRefresh.baseSnapshotId,
            metricIds: metricRefresh.metricIds,
            dateEnd: snapshot.settings.endDate.toISOString(),
          },
        }
      : {}),
  };
}
