import Agenda, { Job } from "agenda";
import { resolveExperimentQualityScoreSettings } from "shared/enterprise";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  getExperimentById,
  getStoppedExperimentIdsByOrganization,
} from "back-end/src/models/ExperimentModel";
import { getOrganizationsWithExperimentQualityScoring } from "back-end/src/models/OrganizationModel";
import { computeAndStoreAIQualityChecks } from "back-end/src/enterprise/services/experimentQualityScore";
import { getAgendaInstance } from "back-end/src/services/queueing";

type UpdateSingleExperimentQualityJob = Job<{
  experimentId: string;
  organization: string;
  force?: boolean;
}>;

const QUEUE_EXPERIMENT_QUALITY_UPDATES = "queueExperimentQualityScoreUpdates";

const UPDATE_SINGLE_EXPERIMENT_QUALITY = "updateSingleExperimentQualityScore";

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_EXPERIMENT_QUALITY_UPDATES, async () => {
    const orgs = await getOrganizationsWithExperimentQualityScoring();

    for (const org of orgs) {
      const settings = resolveExperimentQualityScoreSettings(
        org.settings?.experimentQualityScoreSettings,
      );
      // Only the AI portion of the score is cached; deterministic checks
      // are computed on read, so orgs without AI checks need no sweep
      if (
        !settings.enabled ||
        !settings.aiChecksEnabled ||
        !org.settings?.aiEnabled
      ) {
        continue;
      }

      const experimentIds = await getStoppedExperimentIdsByOrganization(org.id);
      for (const experimentId of experimentIds) {
        await queueSingleExperimentQualityUpdate(agenda, {
          experimentId,
          organization: org.id,
        });
      }
    }
  });

  agenda.define(
    UPDATE_SINGLE_EXPERIMENT_QUALITY,
    updateSingleExperimentQuality,
  );

  const job = agenda.create(QUEUE_EXPERIMENT_QUALITY_UPDATES, {});
  job.unique({});
  job.repeatEvery("30 minutes");
  await job.save();
}

async function queueSingleExperimentQualityUpdate(
  agenda: Agenda,
  {
    experimentId,
    organization,
    force,
  }: { experimentId: string; organization: string; force?: boolean },
) {
  const job = agenda.create(UPDATE_SINGLE_EXPERIMENT_QUALITY, {
    experimentId,
    organization,
    ...(force ? { force } : {}),
  }) as UpdateSingleExperimentQualityJob;

  job.unique({
    experimentId,
    organization,
  });
  job.schedule(new Date());
  await job.save();
}

/**
 * Enqueue an AI quality-score update for a single experiment (e.g. right
 * after it is stopped, or from the manual refresh endpoint).
 */
export async function queueExperimentQualityScoreUpdate({
  experimentId,
  organization,
  force,
}: {
  experimentId: string;
  organization: string;
  force?: boolean;
}) {
  await queueSingleExperimentQualityUpdate(getAgendaInstance(), {
    experimentId,
    organization,
    force,
  });
}

/**
 * Enqueue AI quality-score updates for every stopped, non-archived
 * experiment in the org (e.g. after quality-score settings change). The
 * per-experiment jobs re-check gates and skip fresh results, so this is
 * cheap for experiments whose AI inputs haven't changed.
 */
export async function queueExperimentQualityScoreUpdatesForOrg(
  organization: string,
): Promise<number> {
  const agenda = getAgendaInstance();
  const experimentIds =
    await getStoppedExperimentIdsByOrganization(organization);
  for (const experimentId of experimentIds) {
    await queueSingleExperimentQualityUpdate(agenda, {
      experimentId,
      organization,
    });
  }
  return experimentIds.length;
}

const updateSingleExperimentQuality = async (
  job: UpdateSingleExperimentQualityJob,
) => {
  const experimentId = job.attrs.data?.experimentId;
  const organization = job.attrs.data?.organization;
  const force = job.attrs.data?.force;

  if (!experimentId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);

  const experiment = await getExperimentById(context, experimentId);
  if (!experiment || experiment.archived) return;

  const updated = await computeAndStoreAIQualityChecks({
    context,
    experiment,
    force,
  });
  if (updated) {
    logger.info(
      `Updated AI quality checks for experiment ${experimentId} (org ${organization})`,
    );
  }
};
