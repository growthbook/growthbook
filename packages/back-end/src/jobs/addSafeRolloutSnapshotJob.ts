import Agenda, { Job } from "agenda";
import {
  SafeRolloutInterface,
  SafeRolloutSnapshotInterface,
} from "shared/validators";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { getCollection } from "back-end/src/util/mongo.util";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getSafeRolloutRuleFromFeature,
  isOrphanedSafeRollout,
  shouldSkipScheduledSafeRolloutSnapshot,
} from "back-end/src/routers/safe-rollout/safe-rollout.helper";
import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";
import { COLLECTION_NAME } from "back-end/src/models/SafeRolloutModel";
import { COLLECTION_NAME as SAFE_ROLLOUT_SNAPSHOT_COLLECTION } from "back-end/src/models/SafeRolloutSnapshotModel";
import { getQueryStatusesByIds } from "back-end/src/models/QueryModel";
import { classifyStalledSnapshot } from "back-end/src/jobs/expireOldQueries";

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
  if (feature?.archived) return;

  const rule = feature ? getSafeRolloutRuleFromFeature(feature, id) : null;
  const rampSchedule =
    !rule && safeRollout.rampScheduleId
      ? await context.models.rampSchedules.getById(safeRollout.rampScheduleId)
      : null;
  if (isOrphanedSafeRollout(feature, safeRollout, rampSchedule)) {
    // Stopped drops it from the queue; a revert that re-adds the rule restores
    // the status via the landing path, so leave autoSnapshots alone.
    await context.models.safeRollout.update(safeRollout, { status: "stopped" });
    logger.warn(
      `SafeRollout ${id}: no rule or live ramp schedule references it; marked stopped`,
    );
    return;
  }
  if (!feature) return;

  if (shouldSkipScheduledSafeRolloutSnapshot(feature, safeRollout)) return;

  try {
    const latestSnapshot =
      await context.models.safeRolloutSnapshots.getSnapshotForSafeRollout({
        safeRolloutId: id,
        withResults: false,
      });

    if (latestSnapshot?.status === "running") {
      const stalled = await getStalledSnapshotUpdate(
        organization,
        latestSnapshot,
      );
      if (stalled) {
        await getCollection<SafeRolloutSnapshotInterface>(
          SAFE_ROLLOUT_SNAPSHOT_COLLECTION,
        ).updateOne(
          { id: latestSnapshot.id, status: "running" },
          { $set: { status: "error", ...stalled } },
        );
        logger.warn(
          `SafeRollout ${id}: reaped stalled snapshot ${latestSnapshot.id}; starting a new one`,
        );
      } else {
        // Query is still in-flight. Defer rather than stack — the effective
        // interval becomes max(configuredInterval, actualQueryDuration) naturally.
        const intervalMs =
          (safeRollout.updateScheduleMinutes ?? 60) * 60 * 1000;
        await context.models.safeRollout.update(safeRollout, {
          nextSnapshotAttempt: new Date(Date.now() + intervalMs),
        });
        logger.debug(
          `SafeRollout ${id}: snapshot still running, deferring next attempt by ${intervalMs / 60000}min`,
        );
        return;
      }
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

// Zombie queries (heartbeat lost, orphaned DAG) are reaped system-wide by
// expireOldQueries, but a snapshot whose queries all finished or vanished and
// was never finalized would otherwise defer us forever.
async function getStalledSnapshotUpdate(
  organization: string,
  snapshot: SafeRolloutSnapshotInterface,
): Promise<Pick<SafeRolloutSnapshotInterface, "error" | "queries"> | null> {
  const queryIds = [...new Set(snapshot.queries.map((q) => q.query))];
  if (!queryIds.length) return null;
  const queryStatuses = await getQueryStatusesByIds(organization, queryIds);
  const statusById = new Map(queryStatuses.map((s) => [s.id, s.status]));
  const queries = snapshot.queries.map((q) => ({
    ...q,
    status: statusById.get(q.query) ?? "failed",
  }));
  if (queryStatuses.length !== queryIds.length) {
    return {
      queries,
      error:
        "Snapshot stalled: some of its queries no longer exist. A new snapshot has been started.",
    };
  }
  const verdict = classifyStalledSnapshot({
    queryStatuses,
    snapshotDateCreated: snapshot.dateCreated,
    now: Date.now(),
  });
  if (verdict === "active") return null;
  return {
    queries,
    error:
      verdict === "stalled-terminal"
        ? "Snapshot stalled: queries finished but results were never finalized. A new snapshot has been started."
        : "Snapshot stalled: queries were never started. This can happen when the server restarts mid-refresh. A new snapshot has been started.",
  };
}

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
