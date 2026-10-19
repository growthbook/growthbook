import Agenda, { Job } from "agenda";
import { hasCurrentProcessResults } from "shared/enterprise";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { computeAndStoreProcessResults } from "back-end/src/enterprise/services/experimentProcess";
import { getAgendaInstance } from "back-end/src/services/queueing";

const UPDATE_PROCESS_SCORES = "updateExperimentProcessScores";

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
    const experiments = await getExperimentsByIds(context, experimentIds);
    await computeAndStoreProcessResults(
      context,
      force
        ? experiments
        : experiments.filter((e) => !hasCurrentProcessResults(e)),
    );
  });
}

async function queueJob(
  data: UpdateProcessScoresJob["attrs"]["data"],
  // Jobs sharing a key are merged into one
  uniqueKey: Record<string, unknown>,
) {
  const job = getAgendaInstance().create(
    UPDATE_PROCESS_SCORES,
    data,
  ) as UpdateProcessScoresJob;
  job.unique(uniqueKey);
  job.schedule(new Date());
  await job.save();
}

// Re-judges one experiment, e.g. right after it stops
export function queueExperimentProcessScoreUpdate(
  organization: string,
  experimentId: string,
) {
  return queueJob(
    { organization, experimentIds: [experimentId], force: true },
    { organization, processExperimentId: experimentId },
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
