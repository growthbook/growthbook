import Agenda, { Job } from "agenda";
import type { AuditInterface } from "shared/types/audit";
import type { ExperimentInterface } from "shared/types/experiment";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  getExperimentById,
  getExperimentsWithScheduledStatusUpdate,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getUserById } from "back-end/src/models/UserModel";
import { insertAudit } from "back-end/src/models/AuditModel";
import { executeExperimentStart } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { applyScheduledExperimentStop } from "back-end/src/services/experimentScheduling";
import { isTerminalPublishError } from "back-end/src/util/errors";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import type { ApiReqContext } from "back-end/types/api";
import {
  notifyScheduledEndDecision,
  notifyScheduledStatusUpdateApplied,
  notifyScheduledStatusUpdateFailed,
} from "back-end/src/services/experimentNotifications";

type UpdateSingleExperimentStatusJob = Job<{
  experimentId: string;
  organization: string;
}>;

const QUEUE_EXPERIMENT_STATUS_UPDATES = "queueScheduledExperimentStatusUpdates";

const UPDATE_SINGLE_EXPERIMENT_STATUS = "updateSingleExperimentStatus";

// The QUEUE_* job runs every minute, so without a cap a persistently-failing
// experiment would re-queue forever. Past this many failed attempts, the job
// clears `nextScheduledStatusUpdate` and emits a terminal `experiment.warning`
// instead of retrying.
const SCHEDULED_STATUS_UPDATE_MAX_ATTEMPTS = 5;

// Only the exact update a job processed may be cleared or marked failed, not
// the same action re-staged by someone else meanwhile.
type StagedUpdate = NonNullable<
  ExperimentInterface["nextScheduledStatusUpdate"]
>;
const sameStagedUpdate = (
  a: StagedUpdate | null | undefined,
  b: StagedUpdate,
): boolean =>
  !!a &&
  a.type === b.type &&
  a.date.getTime() === b.date.getTime() &&
  (a.scheduledBy ?? null) === (b.scheduledBy ?? null) &&
  (a.scheduledByApiKey ?? null) === (b.scheduledByApiKey ?? null);

// The change was authorized when it was armed; the job fires as itself and the
// audit entry names whoever armed it.
async function armedBy(
  context: ApiReqContext,
  staged: StagedUpdate,
): Promise<AuditInterface["user"]> {
  if (staged.scheduledBy) {
    const user = await getUserById(staged.scheduledBy);
    if (user) return { id: user.id, email: user.email, name: user.name || "" };
  }
  if (staged.scheduledByApiKey) {
    const key = await context.models.apiKeys.getById(staged.scheduledByApiKey);
    return { apiKey: staged.scheduledByApiKey, name: key?.description || "" };
  }
  return { system: true };
}

async function auditStatusChange(
  context: ApiReqContext,
  staged: StagedUpdate,
  before: ExperimentInterface,
  after: ExperimentInterface,
): Promise<void> {
  await insertAudit({
    event: "experiment.status",
    entity: { object: "experiment", id: before.id },
    details: auditDetailsUpdate(before, after),
    user: await armedBy(context, staged),
    organization: context.org.id,
    dateCreated: new Date(),
  });
}

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_EXPERIMENT_STATUS_UPDATES, async () => {
    const experiments = await getExperimentsWithScheduledStatusUpdate();

    for (const experiment of experiments) {
      await queueExperimentStatusUpdate(experiment.id, experiment.organization);
    }
  });

  agenda.define(UPDATE_SINGLE_EXPERIMENT_STATUS, updateSingleExperimentStatus);

  await startUpdateJob();

  async function startUpdateJob() {
    const job = agenda.create(QUEUE_EXPERIMENT_STATUS_UPDATES, {});
    job.unique({});
    job.repeatEvery("1 minute");
    await job.save();
  }

  async function queueExperimentStatusUpdate(
    experimentId: string,
    organization: string,
  ) {
    const job = agenda.create(UPDATE_SINGLE_EXPERIMENT_STATUS, {
      experimentId,
      organization,
    }) as UpdateSingleExperimentStatusJob;

    job.unique({
      experimentId,
      organization,
    });
    job.schedule(new Date());
    await job.save();
  }
}

export const updateSingleExperimentStatus = async (
  job: UpdateSingleExperimentStatusJob,
) => {
  const experimentId = job.attrs.data?.experimentId;
  const organization = job.attrs.data?.organization;

  if (!experimentId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);

  const experiment = await getExperimentById(context, experimentId);
  if (!experiment) return;

  if (experiment.archived || experiment.status === "stopped") {
    logger.info(
      `Skipping status update: Experiment ${experiment.id} is ${experiment.archived ? "archived" : experiment.status}`,
    );
    await updateExperiment({
      context,
      experiment,
      changes: { nextScheduledStatusUpdate: null },
    });
    return;
  }

  const scheduled = experiment.nextScheduledStatusUpdate;
  if (!scheduled?.date) {
    logger.info(
      `Skipping status update: Experiment ${experiment.id} has no scheduled update`,
    );
    return;
  }

  const now = new Date();
  if (scheduled.date > now) {
    logger.info(
      `Skipping status update: Experiment ${experiment.id} scheduled update is in the future (possibly rescheduled).`,
    );
    return;
  }

  try {
    logger.info("Start updating status for experiment " + experiment.id);

    switch (scheduled.type) {
      case "start": {
        if (experiment.status !== "draft") {
          logger.info(
            `Skipping start: Experiment ${experiment.id} is not in a schedulable state (status=${experiment.status}).`,
          );
          await updateExperiment({
            context,
            experiment,
            changes: { nextScheduledStatusUpdate: null },
          });
          return;
        }

        const { updated } = await executeExperimentStart(context, experiment);
        await auditStatusChange(context, scheduled, experiment, updated);
        await notifyScheduledStatusUpdateApplied({
          context,
          experiment,
          action: "started",
        });
        break;
      }
      case "stop": {
        if (experiment.status !== "running") {
          logger.info(
            `Skipping stop: Experiment ${experiment.id} is not running (status=${experiment.status}).`,
          );
          await updateExperiment({
            context,
            experiment,
            changes: { nextScheduledStatusUpdate: null },
          });
          return;
        }

        const metricGroups = await context.models.metricGroups.getAll();

        // A stop refreshes the SDK payload as a side effect.
        const outcome = await applyScheduledExperimentStop({
          context,
          experiment,
          metricGroups,
        });

        // The scheduled end passing can flip the EDF status to decisive
        // without a snapshot update. Compute the decision from the PRE-stop
        // experiment (post-stop it's no longer "running", so scheduledEndPassed
        // would be false) and fire the decision.* event for every outcome,
        // ordered before the scheduled-status-update event.
        await notifyScheduledEndDecision({ context, experiment, metricGroups });

        // Re-load: stopExperiment may have already mutated the experiment, and
        // the notification below needs fresh state either way.
        const latest =
          (await getExperimentById(context, experiment.id)) ?? experiment;
        if (sameStagedUpdate(latest.nextScheduledStatusUpdate, scheduled)) {
          await updateExperiment({
            context,
            experiment: latest,
            changes: { nextScheduledStatusUpdate: null },
          });
        }

        if (outcome.kind === "kept-running") {
          await notifyScheduledStatusUpdateApplied({
            context,
            experiment: latest,
            action: "kept-running",
            recommendedVariationId: outcome.recommendedVariationId ?? undefined,
          });
        } else {
          // Kept-running changes nothing; a stop flips status, results and
          // the released variation.
          await auditStatusChange(context, scheduled, experiment, latest);
          await notifyScheduledStatusUpdateApplied({
            context,
            experiment: latest,
            action: "stopped",
            shipped: outcome.kind === "shipped",
            shippedVariationId:
              outcome.kind === "shipped" ? outcome.variationId : undefined,
            forced: outcome.kind === "shipped" ? outcome.forced : undefined,
          });
        }
        break;
      }
      default:
        logger.info(
          `Skipping status update: Experiment ${experiment.id} has unsupported scheduled type ${scheduled.type}`,
        );
        await updateExperiment({
          context,
          experiment,
          changes: { nextScheduledStatusUpdate: null },
        });
        return;
    }

    logger.info("Successfully updated status for experiment " + experiment.id);
  } catch (e) {
    const attempts = (scheduled.failedAttempts ?? 0) + 1;
    // Same classification as a scheduled publish: a marked-terminal failure
    // (no authority) gives up at once, anything else retries to the cap.
    const willRetry =
      !isTerminalPublishError(e) &&
      attempts < SCHEDULED_STATUS_UPDATE_MAX_ATTEMPTS;
    const reason = e instanceof Error ? e.message : String(e);

    logger.error(
      e,
      `Failed to update experiment status ${experiment.id} (attempt ${attempts}/${SCHEDULED_STATUS_UPDATE_MAX_ATTEMPTS})`,
    );

    if (!willRetry) {
      logger.warn(
        `Giving up on scheduled status update for experiment ${experiment.id} after ${attempts} failed attempts; clearing nextScheduledStatusUpdate.`,
      );
    }

    // A replacement staged meanwhile is not this attempt's outcome; a failed
    // reload keeps the snapshot so the attempt still counts toward the cap.
    const latest =
      (await getExperimentById(context, experiment.id).catch(() => null)) ??
      experiment;
    if (!sameStagedUpdate(latest.nextScheduledStatusUpdate, scheduled)) {
      return;
    }

    // Wrapped: executeExperimentStart may have already written to the
    // experiment, so this can hit a stale-revision error that must not mask
    // the original failure being logged above.
    try {
      await updateExperiment({
        context,
        experiment: latest,
        changes: {
          nextScheduledStatusUpdate: willRetry
            ? { ...scheduled, failedAttempts: attempts }
            : null,
        },
      });
    } catch (inner) {
      logger.error(
        inner,
        `Failed to persist nextScheduledStatusUpdate after status update failure for experiment ${experiment.id}`,
      );
    }

    try {
      await notifyScheduledStatusUpdateFailed({
        context,
        experiment,
        scheduledStatusUpdateType: scheduled.type,
        attempts,
        maxAttempts: SCHEDULED_STATUS_UPDATE_MAX_ATTEMPTS,
        willRetry,
        reason,
      });
    } catch (inner) {
      logger.error(
        inner,
        `Failed to dispatch experiment.warning for scheduled status update failure on ${experiment.id}`,
      );
    }
  }
};
