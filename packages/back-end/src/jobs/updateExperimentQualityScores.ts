import Agenda from "agenda";
import { EXPERIMENT_PROCESS_RULES_VERSION } from "shared/enterprise";
import {
  getAISettingsForOrg,
  getContextForAgendaJobByOrgId,
} from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  getExperimentById,
  getExperimentIdsNeedingProcessResults,
  getExperimentsByIds,
  getUnarchivedExperimentIdsByOrganization,
} from "back-end/src/models/ExperimentModel";
import { queueExperimentProcessScoreBackfill } from "back-end/src/jobs/updateExperimentProcessScores";
import {
  computeAndStoreAIQualityChecks,
  getStaleAIQualityExperimentIds,
} from "back-end/src/enterprise/services/experimentQualityScore";
import { EXPERIMENTATION_HEALTH_SETTINGS_COLLECTION } from "back-end/src/enterprise/models/ExperimentationHealthSettingsModel";
import {
  UPDATE_SINGLE_EXPERIMENT_QUALITY,
  UpdateSingleExperimentQualityJob,
  queueExperimentQualityScoreUpdate,
} from "back-end/src/jobs/experimentQualityScoreQueue";
import { getCollection } from "back-end/src/util/mongo.util";

const QUEUE_EXPERIMENT_QUALITY_UPDATES = "queueExperimentQualityScoreUpdates";

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_EXPERIMENT_QUALITY_UPDATES, async () => {
    // Orgs where quality scoring is on for the organization default or a
    // Project. Cross-org, so it reads the collection directly.
    const orgIds: string[] = await getCollection(
      EXPERIMENTATION_HEALTH_SETTINGS_COLLECTION,
    ).distinct("organization", { "quality.enabled": true });

    for (const orgId of orgIds) {
      try {
        await queueStaleExperimentQualityUpdates(orgId);
      } catch (e) {
        logger.error(e, `Experiment quality sweep failed for org ${orgId}`);
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

// Queues the cached parts of quality scoring that are missing or out of
// date: process results, then AI verdicts (skipped for orgs without AI)
async function queueStaleExperimentQualityUpdates(organization: string) {
  const context = await getContextForAgendaJobByOrgId(organization);
  if (!context.hasPremiumFeature("experiment-quality-score")) return;

  const processIds = await getExperimentIdsNeedingProcessResults(
    organization,
    EXPERIMENT_PROCESS_RULES_VERSION,
  );
  if (processIds.length) {
    await queueExperimentProcessScoreBackfill(organization, processIds);
  }

  if (!(await getAISettingsForOrg(context)).aiEnabled) return;

  const experiments = await getExperimentsByIds(
    context,
    await getUnarchivedExperimentIdsByOrganization(organization),
  );
  const staleIds = await getStaleAIQualityExperimentIds(context, experiments);
  for (const experimentId of staleIds) {
    await queueExperimentQualityScoreUpdate({ experimentId, organization });
  }
}

// Every non-archived experiment in the org
export async function queueExperimentQualityScoreUpdatesForOrg(
  organization: string,
  { force }: { force?: boolean } = {},
): Promise<number> {
  const experimentIds =
    await getUnarchivedExperimentIdsByOrganization(organization);
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
