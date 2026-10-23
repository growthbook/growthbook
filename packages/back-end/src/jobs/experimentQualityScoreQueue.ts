import { Job } from "agenda";
import { getAgendaInstance } from "back-end/src/services/queueing";

// Kept apart from the jobs themselves so the experiment model can queue
// updates without a circular import
export const UPDATE_SINGLE_EXPERIMENT_QUALITY =
  "updateSingleExperimentQualityScore";
export const RECHECK_EXPERIMENT_QUALITY = "recheckExperimentQuality";

type SingleData = {
  experimentId: string;
  organization: string;
  // Re-run even when the cached verdicts are fresh
  force?: boolean;
  // Re-queues so far, after failed AI calls or the AI usage limit
  attempt?: number;
};
export type UpdateSingleExperimentQualityJob = Job<SingleData>;

type RecheckData = {
  organization: string;
  // Re-run fresh verdicts too, as "Recalculate AI verdicts" does
  force?: boolean;
  // Only this Project's experiments; unset is the whole organization
  project?: string;
  // Only experiments scored by an older release of the checks
  outdatedOnly?: boolean;
  // The last experiment id handled; the next page starts after it
  after?: string;
};
export type RecheckExperimentQualityJob = Job<RecheckData>;

// Queuing the same experiment again before it runs replaces the pending
// job, so a delay collects a burst of edits into one run. Retries get their
// own job, since a job can't reschedule itself under its own key.
export async function queueExperimentQualityScoreUpdate({
  delayMs = 0,
  ...data
}: SingleData & { delayMs?: number }) {
  const job = getAgendaInstance().create(
    UPDATE_SINGLE_EXPERIMENT_QUALITY,
    data,
  ) as UpdateSingleExperimentQualityJob;
  job.unique({
    experimentId: data.experimentId,
    organization: data.organization,
    ...(data.attempt ? { qualityRetry: data.attempt } : {}),
  });
  job.schedule(new Date(Date.now() + delayMs));
  await job.save();
}

/**
 * Rechecks the quality scores of a scope's experiments, one page per run so
 * a large organization never holds the queue for long. A pending start of
 * the same pass is replaced rather than duplicated; later pages and
 * rate-limit retries (`dedupe: false`) are separate jobs.
 */
export async function queueExperimentQualityRecheck(
  data: RecheckData,
  {
    delayMs = 0,
    dedupe = !data.after,
  }: { delayMs?: number; dedupe?: boolean } = {},
) {
  const job = getAgendaInstance().create(
    RECHECK_EXPERIMENT_QUALITY,
    data,
  ) as RecheckExperimentQualityJob;
  if (dedupe) {
    job.unique({
      organization: data.organization,
      qualityRecheck: [
        data.project ?? "",
        data.force ? "force" : "",
        data.outdatedOnly ? "outdated" : "",
      ].join(":"),
    });
  }
  job.schedule(new Date(Date.now() + delayMs));
  await job.save();
}
