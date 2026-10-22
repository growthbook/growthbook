import { Job } from "agenda";
import { getAgendaInstance } from "back-end/src/services/queueing";

// Kept apart from the job itself so the experiment model can queue updates
// without a circular import
export const UPDATE_SINGLE_EXPERIMENT_QUALITY =
  "updateSingleExperimentQualityScore";

export type UpdateSingleExperimentQualityJob = Job<{
  experimentId: string;
  organization: string;
  force?: boolean;
}>;

// `force` re-runs the AI checks even when the cached verdicts are fresh.
// Queuing again before it runs replaces the pending job, so a delay
// collects a burst of edits into one run.
export async function queueExperimentQualityScoreUpdate({
  experimentId,
  organization,
  force,
  delayMs = 0,
}: {
  experimentId: string;
  organization: string;
  force?: boolean;
  delayMs?: number;
}) {
  const job = getAgendaInstance().create(UPDATE_SINGLE_EXPERIMENT_QUALITY, {
    experimentId,
    organization,
    ...(force ? { force } : {}),
  }) as UpdateSingleExperimentQualityJob;
  job.unique({ experimentId, organization });
  job.schedule(new Date(Date.now() + delayMs));
  await job.save();
}
