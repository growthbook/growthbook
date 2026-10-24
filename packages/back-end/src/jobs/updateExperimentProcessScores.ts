import Agenda, { Job } from "agenda";
import { hasCurrentProcessResults } from "shared/enterprise";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { computeAndStoreProcessResults } from "back-end/src/enterprise/services/experimentProcess";
import { getAgendaInstance } from "back-end/src/services/queueing";

const UPDATE_PROCESS_SCORES = "updateExperimentProcessScores";
// Experiments judged per run; the rest continue in a follow-up job
const PAGE_SIZE = 25;

type UpdateProcessScoresJob = Job<{
  organization: string;
  experimentIds: string[];
  // Recompute even when the cached results are current (e.g. a re-stop)
  force?: boolean;
}>;

export default function (agenda: Agenda) {
  agenda.define(UPDATE_PROCESS_SCORES, async (job: UpdateProcessScoresJob) => {
    const { organization, experimentIds, force } = job.attrs.data ?? {};
    if (!organization || !experimentIds?.length) return;
    const context = await getContextForAgendaJobByOrgId(organization);
    const experiments = await getExperimentsByIds(
      context,
      experimentIds.slice(0, PAGE_SIZE),
    );
    await computeAndStoreProcessResults(
      context,
      force
        ? experiments
        : experiments.filter((e) => !hasCurrentProcessResults(e)),
    );
    if (experimentIds.length > PAGE_SIZE) {
      await queueJob({
        organization,
        experimentIds: experimentIds.slice(PAGE_SIZE),
        force,
      });
    }
  });
}

async function queueJob(
  data: UpdateProcessScoresJob["attrs"]["data"],
  // Jobs sharing a key are merged into one; follow-up pages have none
  uniqueKey?: Record<string, unknown>,
  delayMs = 0,
) {
  const job = getAgendaInstance().create(
    UPDATE_PROCESS_SCORES,
    data,
  ) as UpdateProcessScoresJob;
  if (uniqueKey) job.unique(uniqueKey);
  job.schedule(new Date(Date.now() + delayMs));
  await job.save();
}

// Callers audit a stop after it returns, so judging waits for that entry
const AFTER_STOP_DELAY_MS = 2 * 60 * 1000;

// Re-judges one experiment once it has stopped
export function queueExperimentProcessScoreUpdate(
  organization: string,
  experimentId: string,
) {
  return queueJob(
    { organization, experimentIds: [experimentId], force: true },
    { organization, processExperimentId: experimentId },
    AFTER_STOP_DELAY_MS,
  );
}

// Fills in missing or outdated results; one pending backfill per org, and
// experiments already up to date are skipped when it runs
export function queueExperimentProcessScoreBackfill(
  organization: string,
  experimentIds: string[],
) {
  return queueJob(
    { organization, experimentIds },
    { organization, processBackfill: true },
  );
}
