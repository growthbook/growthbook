import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { getCollection } from "back-end/src/util/mongo.util";
import { getFeature } from "back-end/src/models/FeatureModel";
import { SafeRolloutRule } from "back-end/src/validators/features";
import { getSafeRolloutRuleFromFeature } from "back-end/src/routers/safe-rollout-snapshot/safe-rollout.helper";
import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";
import {
  COLLECTION_NAME,
  SafeRolloutInterface,
} from "back-end/src/models/SafeRolloutModel";

const UPDATE_SINGLE_SAFE_ROLLOUT_RULE = "updateSingleSafeRolloutRule";
const QUEUE_SAFE_ROLLOUT_SNAPSHOT_UPDATES = "queueSafeRolloutSnapshotUpdates";

type UpdateSingleSafeRolloutRuleJob = Job<{
  safeRollout: SafeRolloutInterface;
  safeRolloutRule: SafeRolloutRule;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_SAFE_ROLLOUT_SNAPSHOT_UPDATES, async () => {
    const safeRollouts = await getAllSafeRolloutsToUpdate();

    for (const safeRollout of safeRollouts) {
      await queueSafeRolloutSnapshotUpdate(safeRollout);
    }
  });

  agenda.define(
    UPDATE_SINGLE_SAFE_ROLLOUT_RULE,
    // This job queries a datasource, which may be slow. Give it 30 minutes to complete.
    { lockLifetime: 30 * 60 * 1000 }, // 30 minutes
    updateSingleSafeRolloutRule
  );

  await startUpdateJob();

  async function startUpdateJob() {
    const updateResultsJob = agenda.create(
      QUEUE_SAFE_ROLLOUT_SNAPSHOT_UPDATES,
      {}
    );
    updateResultsJob.unique({});
    updateResultsJob.repeatEvery("10 minutes");
    await updateResultsJob.save();
  }

  async function queueSafeRolloutSnapshotUpdate(
    safeRollout: SafeRolloutInterface
  ) {
    const job = agenda.create(UPDATE_SINGLE_SAFE_ROLLOUT_RULE, {
      safeRollout,
    });

    job.unique({
      safeRollout,
    });
    job.schedule(new Date());
    await job.save();
  }
}

async function updateSingleSafeRolloutRule(
  job: UpdateSingleSafeRolloutRuleJob
) {
  const safeRollout = job.attrs.data?.safeRollout;
  const { ruleId, organization, featureId } = safeRollout;

  if (!ruleId || !organization || !featureId) return;
  const context = await getContextForAgendaJobByOrgId(organization);
  if (!featureId || !context) return;
  const feature = await getFeature(context, featureId);
  if (!feature) return;

  const safeRolloutRule = getSafeRolloutRuleFromFeature(feature, ruleId);

  if (!safeRolloutRule) return;

  try {
    logger.info("Start Refreshing Results for SafeRollout " + ruleId);
    await createSafeRolloutSnapshot({
      context,
      safeRollout,
      triggeredBy: "schedule",
    });
  } catch (e) {
    logger.error(e, "Failed to create SafeRollout Snapshot: " + ruleId);
  }
}

async function getAllSafeRolloutsToUpdate() {
  const now = new Date();

  const cursor = getCollection<SafeRolloutInterface>(COLLECTION_NAME).find({
    status: { $in: ["running"] },
    startedAt: { $exists: true },
    nextSnapshotUpdate: { $lte: now },
    autoSnapshots: true,
  });

  const safeRollouts = await cursor.toArray();
  return safeRollouts;
}
