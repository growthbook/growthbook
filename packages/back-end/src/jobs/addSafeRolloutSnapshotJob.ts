import Agenda, { Job } from "agenda";
import { SafeRolloutInterface } from "shared/validators";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { getCollection } from "back-end/src/util/mongo.util";
import { getFeature } from "back-end/src/models/FeatureModel";
import { shouldSkipScheduledSafeRolloutSnapshot } from "back-end/src/routers/safe-rollout/safe-rollout.helper";
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
    // 1-minute polling is safe: createSafeRolloutSnapshot advances
    // nextSnapshotAttempt to the *next* scheduled window before starting
    // the warehouse query, so a safe rollout that is mid-query won't match
    // the nextSnapshotAttempt: { $lte: now } filter and won't be re-queued
    // until its next scheduled window arrives.
    updateResultsJob.repeatEvery("1 minute");
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

  if (shouldSkipScheduledSafeRolloutSnapshot(feature, safeRollout)) return;

  try {
    const latestSnapshot =
      await context.models.safeRolloutSnapshots.getSnapshotForSafeRollout({
        safeRolloutId: id,
        withResults: false,
      });

    if (latestSnapshot?.status === "running") {
      // Query is still in-flight. Defer rather than stack — the effective
      // interval becomes max(configuredInterval, actualQueryDuration) naturally.
      // Zombie queries (heartbeat lost, orphaned DAG) are handled system-wide
      // by expireOldQueries, so no manual kill is needed here.
      const intervalMs = (safeRollout.updateScheduleMinutes ?? 60) * 60 * 1000;
      await context.models.safeRollout.update(safeRollout, {
        nextSnapshotAttempt: new Date(Date.now() + intervalMs),
      });
      logger.debug(
        `SafeRollout ${id}: snapshot still running, deferring next attempt by ${intervalMs / 60000}min`,
      );
      return;
    }

    logger.info("Start Refreshing Results for SafeRollout " + id);
    await createSafeRolloutSnapshot({
      context,
      safeRollout,
      customFields: feature.customFields,
      triggeredBy: "schedule",
    });
    // Fire-and-forget: SafeRolloutSnapshotModel.afterUpdate handles evaluation
    // and notifications when warehouse results arrive. Awaiting waitForResults()
    // here would hold an Agenda lock slot (defaultLockLimit: 5) for the full
    // warehouse query duration, starving other jobs and risking a mid-run
    // re-queue if the query exceeds defaultLockLifetime (10 min).
    logger.info("Queued SafeRollout Snapshot refresh for " + id);
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
