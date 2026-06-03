import Agenda, { Job } from "agenda";
import { dangerousFindContextualBanditsWithScheduledStatusUpdate } from "back-end/src/enterprise/models/ContextualBanditModel";
import { executeContextualBanditStart } from "back-end/src/services/contextualBanditChanges";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { logger } from "back-end/src/util/logger";

/**
 * Background agenda job for scheduled CB status transitions.
 *
 * Parallel to `updateExperimentStatus.ts` but scoped to ContextualBandit
 * docs. Polls CBs whose `nextScheduledStatusUpdate.date` is due and runs
 * the requested transition (start today; stop will follow once
 * `statusUpdateSchedule.stopAt` lands per the experiment TODO).
 *
 * Retry semantics mirror the experiment job: each failure increments
 * `failedAttempts`; once the count hits the cap the schedule is cleared
 * and a terminal warning event is recorded (Slack / email / webhook
 * subscribers come with the v1.5 CB notifications work — for now we just
 * audit and log).
 */

const QUEUE_CB_STATUS_UPDATES = "queueContextualBanditScheduledStatusUpdates";
const UPDATE_SINGLE_CB_STATUS = "updateSingleContextualBanditStatus";

// Caps retries of a scheduled CB status transition. Mirrors the experiment
// job's value — if a CB's linked-feature draft has a persistent merge
// conflict or approval block, we don't want the agenda to retry forever.
const SCHEDULED_STATUS_UPDATE_MAX_ATTEMPTS = 5;

type UpdateSingleCBStatusJob = Job<{
  contextualBanditId: string;
  organization: string;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_CB_STATUS_UPDATES, async () => {
    const cbs = await dangerousFindContextualBanditsWithScheduledStatusUpdate();
    for (const cb of cbs) {
      await queueCBStatusUpdate(cb.id, cb.organization);
    }
  });

  agenda.define(UPDATE_SINGLE_CB_STATUS, updateSingleCBStatus);

  await startUpdateJob();

  async function startUpdateJob() {
    const job = agenda.create(QUEUE_CB_STATUS_UPDATES, {});
    job.unique({});
    // Same cadence as the experiment status job.
    job.repeatEvery("1 minute");
    await job.save();
  }

  async function queueCBStatusUpdate(
    contextualBanditId: string,
    organization: string,
  ) {
    const job = agenda.create(UPDATE_SINGLE_CB_STATUS, {
      contextualBanditId,
      organization,
    }) as UpdateSingleCBStatusJob;
    job.unique({ contextualBanditId, organization });
    job.schedule(new Date());
    await job.save();
  }
}

const updateSingleCBStatus = async (job: UpdateSingleCBStatusJob) => {
  const cbId = job.attrs.data?.contextualBanditId;
  const organization = job.attrs.data?.organization;
  if (!cbId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);

  const cb = await context.models.contextualBandits.getById(cbId);
  if (!cb) return;

  // Already past the transition window — clear the schedule and bail
  // (matches the experiment job's archived/already-transitioned guard).
  if (cb.archived || cb.status === "running" || cb.status === "stopped") {
    logger.info(
      `Skipping CB status update: ${cb.id} is ${cb.archived ? "archived" : cb.status}`,
    );
    await context.models.contextualBandits.update(cb, {
      nextScheduledStatusUpdate: null,
    });
    return;
  }

  const scheduled = cb.nextScheduledStatusUpdate;
  if (!scheduled?.date) {
    logger.info(`Skipping CB status update: ${cb.id} has no scheduled update`);
    return;
  }

  const now = new Date();
  if (scheduled.date > now) {
    logger.info(
      `Skipping CB status update: ${cb.id} scheduled update is in the future (possibly rescheduled)`,
    );
    return;
  }

  try {
    logger.info("Start updating status for contextual bandit " + cb.id);

    switch (scheduled.type) {
      case "start": {
        if (cb.status !== "draft") {
          logger.info(
            `Skipping CB start: ${cb.id} is not in a schedulable state (status=${cb.status})`,
          );
          await context.models.contextualBandits.update(cb, {
            nextScheduledStatusUpdate: null,
          });
          return;
        }

        const cbBefore = cb;
        const { updated } = await executeContextualBanditStart(context, cb);
        // Clear the schedule on success; the start helper itself doesn't
        // know it was schedule-driven, so we do the bookkeeping here.
        const cleared = await context.models.contextualBandits.update(updated, {
          nextScheduledStatusUpdate: null,
        });
        await context.auditLog({
          event: "contextualBandit.start",
          entity: {
            object: "contextualBandit",
            id: cbBefore.id,
          },
          details: auditDetailsUpdate(cbBefore, cleared),
        });
        break;
      }
      // TODO(schedule-status-updates): handle "stop" once
      // statusUpdateScheduleValidator carries `stopAt` — mirrors the
      // experiment-side TODO so the two stay aligned.
      default:
        logger.info(
          `Skipping CB status update: ${cb.id} has unsupported scheduled type ${scheduled.type}`,
        );
        await context.models.contextualBandits.update(cb, {
          nextScheduledStatusUpdate: null,
        });
        return;
    }

    logger.info("Successfully updated status for contextual bandit " + cb.id);
  } catch (e) {
    const attempts = (scheduled.failedAttempts ?? 0) + 1;
    const willRetry = attempts < SCHEDULED_STATUS_UPDATE_MAX_ATTEMPTS;
    logger.error(
      e,
      `Failed to update CB status ${cb.id} (attempt ${attempts}/${SCHEDULED_STATUS_UPDATE_MAX_ATTEMPTS})`,
    );

    if (!willRetry) {
      logger.warn(
        `Giving up on scheduled status update for CB ${cb.id} after ${attempts} failed attempts; clearing nextScheduledStatusUpdate.`,
      );
    }

    // Persist the new attempt count (or clear the schedule once we've hit
    // the cap). Wrapped so a failure to record state doesn't mask the
    // original error in the logs.
    try {
      await context.models.contextualBandits.update(cb, {
        nextScheduledStatusUpdate: willRetry
          ? { ...scheduled, failedAttempts: attempts }
          : null,
      });
    } catch (inner) {
      logger.error(
        inner,
        `Failed to persist nextScheduledStatusUpdate after status update failure for CB ${cb.id}`,
      );
    }

    // v1.5: dispatch Slack / email / webhook notifications here once the CB
    // notifications subscriber surface lands (mirrors
    // `notifyScheduledStatusUpdateFailed` on the experiment side).
  }
};
