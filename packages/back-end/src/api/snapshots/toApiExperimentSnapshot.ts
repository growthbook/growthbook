import { z } from "zod";
import { getMetricRefresh } from "shared/experiments";
import { apiExperimentSnapshotValidator } from "shared/validators";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";

export function toApiExperimentSnapshot(
  snapshot: ExperimentSnapshotInterface,
): z.infer<typeof apiExperimentSnapshotValidator> {
  const metricRefresh = getMetricRefresh(snapshot);
  const dateEnd = snapshot.settings.endDate.toISOString();
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
            dateEnd,
          },
          updateScope: "new_metrics" as const,
          notice: `Only the newly added metrics were computed. Every result, including theirs, covers data up to ${dateEnd}. For newer data, run a normal update: POST /experiments/${snapshot.experiment}/snapshot with "missingMetricsOnly": false.`,
        }
      : { updateScope: "all_metrics" as const }),
  };
}
