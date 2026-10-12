import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  getExperimentById,
  getStoppedExperimentIdsByOrganization,
} from "back-end/src/models/ExperimentModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import { computeAndStoreAIQualityChecks } from "back-end/src/enterprise/services/experimentQualityScore";
import { EXPERIMENTATION_HEALTH_SETTINGS_COLLECTION } from "back-end/src/enterprise/models/ExperimentationHealthSettingsModel";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { getCollection } from "back-end/src/util/mongo.util";

type UpdateSingleExperimentQualityJob = Job<{
  experimentId: string;
  organization: string;
  force?: boolean;
}>;

const QUEUE_EXPERIMENT_QUALITY_UPDATES = "queueExperimentQualityScoreUpdates";

const UPDATE_SINGLE_EXPERIMENT_QUALITY = "updateSingleExperimentQualityScore";

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_EXPERIMENT_QUALITY_UPDATES, async () => {
    // Orgs where quality scoring is on for the organization default or a
    // Project. Cross-org, so it reads the collection directly.
    const orgIds: string[] = await getCollection(
      EXPERIMENTATION_HEALTH_SETTINGS_COLLECTION,
    ).distinct("organization", { "quality.enabled": true });

    for (const orgId of orgIds) {
      // Only AI verdicts are cached; deterministic checks are computed on
      // read, so orgs without AI need no sweep
      const org = await findOrganizationById(orgId);
      if (!org?.settings?.aiEnabled) continue;
      await queueExperimentQualityScoreUpdatesForOrg(orgId);
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

// `force` re-runs the AI checks even when the cached verdicts are fresh
export async function queueExperimentQualityScoreUpdate({
  experimentId,
  organization,
  force,
}: {
  experimentId: string;
  organization: string;
  force?: boolean;
}) {
  const job = getAgendaInstance().create(UPDATE_SINGLE_EXPERIMENT_QUALITY, {
    experimentId,
    organization,
    ...(force ? { force } : {}),
  }) as UpdateSingleExperimentQualityJob;
  job.unique({ experimentId, organization });
  job.schedule(new Date());
  await job.save();
}

// Every stopped, non-archived experiment in the org
export async function queueExperimentQualityScoreUpdatesForOrg(
  organization: string,
  { force }: { force?: boolean } = {},
): Promise<number> {
  const experimentIds =
    await getStoppedExperimentIdsByOrganization(organization);
  for (const experimentId of experimentIds) {
    await queueExperimentQualityScoreUpdate({
      experimentId,
      organization,
      force,
    });
  }
  return experimentIds.length;
}

const updateSingleExperimentQuality = async (
  job: UpdateSingleExperimentQualityJob,
) => {
  const { experimentId, organization, force } = job.attrs.data ?? {};
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
