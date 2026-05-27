import Agenda, { Job } from "agenda";
import { SafeRolloutInterface } from "shared/validators";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { getCollection } from "back-end/src/util/mongo.util";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getSafeRolloutRuleFromFeature } from "back-end/src/routers/safe-rollout/safe-rollout.helper";
import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";
import { COLLECTION_NAME } from "back-end/src/models/SafeRolloutModel";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { SafeRolloutResultsQueryRunner } from "back-end/src/queryRunners/SafeRolloutResultsQueryRunner";

const UPDATE_SINGLE_SAFE_ROLLOUT_SNAPSHOT = "updateSingleSafeRolloutSnapshot";
const QUEUE_SAFE_ROLLOUT_SNAPSHOT_UPDATES = "queueSafeRolloutSnapshotUpdates";

// A snapshot running longer than this is considered hung and will be killed so
// a fresh one can start. Separate from the configured update interval.
const HUNG_QUERY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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

  const safeRolloutRule = getSafeRolloutRuleFromFeature(feature, id, true);
  if (!safeRolloutRule || !safeRolloutRule.enabled) return;

  try {
    const latestSnapshot =
      await context.models.safeRolloutSnapshots.getSnapshotForSafeRollout({
        safeRolloutId: id,
        withResults: false,
      });

    if (latestSnapshot?.status === "running") {
      const runningForMs =
        Date.now() - (latestSnapshot.runStarted?.getTime() ?? Date.now());

      if (runningForMs < HUNG_QUERY_TIMEOUT_MS) {
        // Query is in-flight and not hung. Defer the next attempt by the
        // configured interval so we check again after it should have finished.
        // The effective interval becomes max(configuredInterval, queryDuration)
        // naturally, with no artificial floor.
        const intervalMs =
          (safeRollout.updateScheduleMinutes ?? 60) * 60 * 1000;
        await context.models.safeRollout.update(safeRollout, {
          nextSnapshotAttempt: new Date(Date.now() + intervalMs),
        });
        logger.debug(
          `SafeRollout ${id}: snapshot still running (${Math.round(runningForMs / 1000)}s), deferring next attempt by ${intervalMs / 60000}min`,
        );
        return;
      }

      // Query has been running longer than the hang timeout — kill it and
      // start fresh so the safe rollout can resume producing results.
      logger.warn(
        `SafeRollout ${id}: snapshot ${latestSnapshot.id} has been running for ${Math.round(runningForMs / 60000)}min (>${HUNG_QUERY_TIMEOUT_MS / 60000}min hang threshold), killing and restarting`,
      );
      try {
        const integration = await getIntegrationFromDatasourceId(
          context,
          latestSnapshot.settings.datasourceId,
        );
        const hungRunner = new SafeRolloutResultsQueryRunner(
          context,
          latestSnapshot,
          integration,
        );
        await hungRunner.cancelQueries();
      } catch (cancelErr) {
        logger.warn(
          cancelErr,
          `Failed to cancel hung snapshot ${latestSnapshot.id} for SafeRollout ${id} — proceeding with fresh snapshot anyway`,
        );
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
