import Agenda, { Job } from "agenda";
import { SafeRolloutInterface } from "shared/validators";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { getCollection } from "back-end/src/util/mongo.util";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getSafeRolloutRuleFromFeature } from "back-end/src/routers/safe-rollout/safe-rollout.helper";
import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";
import { COLLECTION_NAME } from "back-end/src/models/SafeRolloutModel";

const UPDATE_SINGLE_SAFE_ROLLOUT_SNAPSHOT = "updateSingleSafeRolloutSnapshot";
const QUEUE_SAFE_ROLLOUT_SNAPSHOT_UPDATES = "queueSafeRolloutSnapshotUpdates";

type UpdateSingleSafeRolloutSnapshotJob = Job<{
  safeRollout: SafeRolloutInterface;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_SAFE_ROLLOUT_SNAPSHOT_UPDATES, async () => {
    const safeRollouts = await getAllSafeRolloutsToUpdate();

    for (const safeRollout of safeRollouts) {
      await queueSafeRolloutSnapshotUpdate(safeRollout);
    }
  });

  agenda.define(
    UPDATE_SINGLE_SAFE_ROLLOUT_SNAPSHOT,
    updateSingleSafeRolloutSnapshot,
  );

  await startUpdateJob();

  async function startUpdateJob() {
    const updateResultsJob = agenda.create(
      QUEUE_SAFE_ROLLOUT_SNAPSHOT_UPDATES,
      {},
    );
    updateResultsJob.unique({});
    updateResultsJob.repeatEvery("10 minutes");
    await updateResultsJob.save();
  }

  async function queueSafeRolloutSnapshotUpdate(
    safeRollout: SafeRolloutInterface,
  ) {
    const job = agenda.create(UPDATE_SINGLE_SAFE_ROLLOUT_SNAPSHOT, {
      safeRollout,
    });
    job.unique({ id: safeRollout.id });
    job.schedule(new Date());
    await job.save();
  }
}

const updateSingleSafeRolloutSnapshot = async (
  job: UpdateSingleSafeRolloutSnapshotJob,
) => {
  const { safeRollout } = job.attrs.data;

  const { id, organization, featureId } = safeRollout;
  if (!id || !organization || !featureId) return;

  const context = await getContextForAgendaJobByOrgId(organization);
  const feature = await getFeature(context, featureId);
  if (!feature || feature.archived) return;

  const safeRolloutRule = getSafeRolloutRuleFromFeature(feature, id, true);
  if (!safeRolloutRule || !safeRolloutRule.enabled) return;

  try {
    logger.info("Start Refreshing Results for SafeRollout " + id);
    await createSafeRolloutSnapshot({
      context,
      safeRollout,
      customFields: feature.customFields,
      triggeredBy: "schedule",
    });
  } catch (e) {
    logger.error(e, "Failed to create SafeRollout Snapshot: " + id);
  }
};

async function getAllSafeRolloutsToUpdate() {
  const now = new Date();

  const cursor = getCollection<SafeRolloutInterface>(COLLECTION_NAME).find({
    status: { $in: ["running"] },
    startedAt: { $exists: true },
    nextSnapshotAttempt: { $lte: now },
    autoSnapshots: true,
  });

  const safeRollouts = await cursor.toArray();
  return safeRollouts;
}
