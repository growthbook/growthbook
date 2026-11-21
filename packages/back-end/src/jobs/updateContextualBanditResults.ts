import Agenda, { Job } from "agenda";
import { dangerousFindContextualBanditsToUpdate } from "back-end/src/enterprise/models/ContextualBanditModel";
import { runContextualBanditSnapshot } from "back-end/src/enterprise/services/contextualBandits";
import { determineNextContextualBanditSchedule } from "back-end/src/services/contextualBanditSchedule";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { PlanDoesNotAllowError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

const QUEUE_CB_RESULTS_UPDATES = "queueContextualBanditUpdates";
const UPDATE_SINGLE_CB = "updateSingleContextualBandit";
// Used when the bandit's schedule can't be computed (e.g. unset settings).
const SCHEDULE_FALLBACK_DELAY_MS = 60 * 60 * 1000;

type UpdateSingleCBJobData = {
  organization: string;
  contextualBanditId: string;
};
type UpdateSingleCBJob = Job<UpdateSingleCBJobData>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_CB_RESULTS_UPDATES, async () => {
    const cbs = await dangerousFindContextualBanditsToUpdate([]);
    for (const cb of cbs) {
      await queueContextualBanditUpdate(cb.organization, cb.id);
    }
  });

  agenda.define(UPDATE_SINGLE_CB, updateSingleContextualBandit);

  await startUpdateJob();

  async function startUpdateJob() {
    const job = agenda.create(QUEUE_CB_RESULTS_UPDATES, {});
    job.unique({});
    job.repeatEvery("5 minutes");
    await job.save();
  }

  async function queueContextualBanditUpdate(
    organization: string,
    contextualBanditId: string,
  ) {
    const job = agenda.create<UpdateSingleCBJobData>(UPDATE_SINGLE_CB, {
      organization,
      contextualBanditId,
    }) as UpdateSingleCBJob;
    job.unique({ contextualBanditId, organization });
    job.schedule(new Date());
    await job.save();
  }
}

export const updateSingleContextualBandit = async (job: UpdateSingleCBJob) => {
  const cbId = job.attrs.data?.contextualBanditId;
  const orgId = job.attrs.data?.organization;
  if (!cbId || !orgId) return;

  const context = await getContextForAgendaJobByOrgId(orgId);

  const cb = await context.models.contextualBandits.getById(cbId);
  if (!cb) return;

  const logContext = { organization: orgId, contextualBanditId: cbId };

  // The run can never succeed without the feature, so pause rather than
  // re-queue every tick. Re-enabling auto-updates is manual.
  if (!context.hasPremiumFeature("contextual-bandits")) {
    try {
      await context.models.contextualBandits.dangerousUpdateBypassPermission(
        cb,
        { autoSnapshots: false },
      );
      logger.warn(
        logContext,
        "Paused scheduled updates for contextual bandit, plan does not allow it: " +
          cbId,
      );
    } catch (e) {
      logger.error(
        { ...logContext, err: e },
        "Failed to pause contextual bandit: " + cbId,
      );
    }
    return;
  }

  let nextSnapshotAttempt: Date;
  // The run re-derives the same schedule and would throw too, so skip it.
  let scheduleInvalid = false;
  try {
    nextSnapshotAttempt = determineNextContextualBanditSchedule(cb);
  } catch (e) {
    nextSnapshotAttempt = new Date(Date.now() + SCHEDULE_FALLBACK_DELAY_MS);
    scheduleInvalid = true;
    logger.warn(
      { ...logContext, err: e },
      "Could not compute next schedule for contextual bandit, retrying later: " +
        cbId,
    );
  }

  try {
    // Advance BEFORE the run so a failing or slow snapshot isn't re-queued
    // every tick; runContextualBanditSnapshot re-derives the schedule itself.
    // Bypasses the premium gate so this safety net can't fail on it.
    await context.models.contextualBandits.dangerousUpdateBypassPermission(cb, {
      nextSnapshotAttempt,
      lastSnapshotAttempt: new Date(),
    });
  } catch (e) {
    logger.error(
      { ...logContext, err: e },
      "Failed to advance schedule for contextual bandit: " + cbId,
    );
    return;
  }
  if (scheduleInvalid) return;

  try {
    logger.info("Refreshing results for contextual bandit " + cbId);
    await runContextualBanditSnapshot(context, cb, {
      triggeredBy: "scheduled",
      wait: true,
    });
    logger.info("Successfully refreshed results for contextual bandit " + cbId);
  } catch (e) {
    if (e instanceof PlanDoesNotAllowError) {
      logger.warn(
        { ...logContext, err: e },
        "Skipped contextual bandit update, plan does not allow it: " + cbId,
      );
      return;
    }
    logger.error(
      { ...logContext, err: e },
      "Failed to update contextual bandit: " + cbId,
    );
  }
};
