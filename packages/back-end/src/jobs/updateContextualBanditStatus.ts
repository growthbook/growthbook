import Agenda, { Job } from "agenda";
import { dangerousFindContextualBanditsWithScheduledStatusUpdate } from "back-end/src/enterprise/models/ContextualBanditModel";
import { executeContextualBanditStart } from "back-end/src/services/contextualBanditChanges";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { logger } from "back-end/src/util/logger";

const QUEUE_CB_STATUS_UPDATES = "queueContextualBanditScheduledStatusUpdates";
const UPDATE_SINGLE_CB_STATUS = "updateSingleContextualBanditStatus";

// Cap retries so a persistently failing CB doesn't get retried forever.
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

  // Enterprise-only: short-circuit before any side effects (e.g. publishing
  // pending feature drafts) so a downgraded org's scheduled updates don't run.
  if (!context.hasPremiumFeature("contextual-bandits")) {
    logger.info(
      `Skipping CB status update: org ${organization} lacks contextual-bandits feature`,
    );
    return;
  }

  const cb = await context.models.contextualBandits.getById(cbId);
  if (!cb) return;

  // Past the transition window: clear the schedule and bail.
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
        // Clear the schedule on success (start helper is schedule-agnostic).
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
      // TODO(schedule-status-updates): handle "stop" once `statusUpdateScheduleValidator` carries `stopAt`.
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

    // Persist the attempt count (or clear on cap); wrapped so a state-write failure can't mask the original error.
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

    // TODO(v1.5): dispatch Slack/email/webhook notifications once the CB subscriber surface lands.
  }
};
