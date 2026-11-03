import Agenda, { Job } from "agenda";
import { interleavingAutoSnapshotScheduled } from "shared/util";
import { dangerousFindInterleavingsToUpdate } from "back-end/src/enterprise/models/InterleavingModel";
import { runInterleavingSnapshot } from "back-end/src/enterprise/services/interleavingAnalysis";
import { determineNextDate } from "back-end/src/services/experiments";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";

const QUEUE_INTERLEAVING_RESULTS_UPDATES = "queueInterleavingUpdates";
const UPDATE_SINGLE_INTERLEAVING = "updateSingleInterleaving";

const UNLICENSED_BACKOFF_MS = 24 * 60 * 60 * 1000;

type UpdateSingleInterleavingJobData = {
  organization: string;
  interleavingId: string;
};
type UpdateSingleInterleavingJob = Job<UpdateSingleInterleavingJobData>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_INTERLEAVING_RESULTS_UPDATES, async () => {
    const interleavings = await dangerousFindInterleavingsToUpdate([]);
    for (const il of interleavings) {
      await queueInterleavingUpdate(il.organization, il.id);
    }
  });

  agenda.define(UPDATE_SINGLE_INTERLEAVING, updateSingleInterleaving);

  await startUpdateJob();

  async function startUpdateJob() {
    const job = agenda.create(QUEUE_INTERLEAVING_RESULTS_UPDATES, {});
    job.unique({});
    job.repeatEvery("5 minutes");
    await job.save();
  }

  async function queueInterleavingUpdate(
    organization: string,
    interleavingId: string,
  ) {
    const job = agenda.create<UpdateSingleInterleavingJobData>(
      UPDATE_SINGLE_INTERLEAVING,
      { organization, interleavingId },
    ) as UpdateSingleInterleavingJob;
    job.unique({ interleavingId, organization });
    job.schedule(new Date());
    await job.save();
  }
}

const updateSingleInterleaving = async (job: UpdateSingleInterleavingJob) => {
  const interleavingId = job.attrs.data?.interleavingId;
  const orgId = job.attrs.data?.organization;
  if (!interleavingId || !orgId) return;

  const context = await getContextForAgendaJobByOrgId(orgId);

  const il = await context.models.interleavings.getById(interleavingId);
  if (!il) return;

  if (!interleavingAutoSnapshotScheduled(il)) return;
  if (!il.nextSnapshotAttempt || il.nextSnapshotAttempt > new Date()) return;

  try {
    if (!context.hasPremiumFeature("interleaving")) {
      await context.models.interleavings.dangerousDeferSnapshotSchedule(
        interleavingId,
        new Date(Date.now() + UNLICENSED_BACKOFF_MS),
      );
      logger.warn(
        `Skipping scheduled interleaving update, plan does not allow it: ${interleavingId}`,
      );
      return;
    }

    const nextSnapshotAttempt = determineNextDate(
      context.org.settings?.updateSchedule || null,
    );
    if (!nextSnapshotAttempt) {
      await context.models.interleavings.update(il, { autoSnapshots: false });
      return;
    }

    await context.models.interleavings.update(il, {
      nextSnapshotAttempt,
      lastSnapshotAttempt: new Date(),
    });

    const active =
      await context.models.interleavingSnapshots.listActiveForInterleaving(
        interleavingId,
      );
    if (active.length) {
      logger.info(
        `Skipping scheduled interleaving update, refresh still in flight: ${interleavingId}`,
      );
      return;
    }

    logger.info("Refreshing results for interleaving " + interleavingId);
    await runInterleavingSnapshot(context, interleavingId);
    logger.info(
      "Successfully refreshed results for interleaving " + interleavingId,
    );
  } catch (e) {
    logger.error(e, "Failed to update interleaving: " + interleavingId);
  }
};
