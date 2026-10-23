import {
  ExperimentInterfaceExcludingHoldouts,
  postExperimentStartValidator,
} from "shared/validators";
import { getValidDate } from "shared/dates";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { ReqContext } from "back-end/types/request";
import {
  approveScheduledExperimentStart,
  startApprovalsWaivedBy,
  startExperiment,
  validateExperimentChange,
} from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  confirmationLink,
  queuedDraftsHold,
  requireConfirmation,
} from "back-end/src/services/confirmations";
import { toEnhancedExperimentApiResponse } from "./enhancedExperimentResponse";

function formatScheduledStartUtc(date: Date): string {
  const datePart = date.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = date.toLocaleString("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart} at ${timePart} UTC`;
}

export const postExperimentStart = createApiRequestHandler(
  postExperimentStartValidator,
)(async (req) => {
  const context = req.context as ReqContext;

  const existing = await getExperimentById(context, req.params.id);
  if (!existing) {
    throw new Error("Could not find experiment with that id");
  }
  if (existing.type === "holdout") {
    throw new Error("Holdouts are not supported via this API");
  }

  // Staging a scheduled start is held too: it starts later with no one present.
  const queued = await queuedDraftsHold(context, existing.pendingFeatureDrafts);
  // A key's authority waives the drafts' open approvals unasked, so the hold
  // names that bypass whenever there's one to waive.
  const waivesApproval =
    (await startApprovalsWaivedBy(context, existing)).size > 0;
  await requireConfirmation(context, {
    actions: ["experiment.start", ...queued.actions],
    bypassing: waivesApproval
      ? [
          {
            type: "approval-required",
            outcome: "bypassed",
            via: "bypassApprovalPermission",
          },
        ]
      : [],
    project: existing.project,
    summary: `Start ${existing.name}`,
    links: [
      confirmationLink("experiment", existing.id, existing.name),
      ...queued.links,
    ],
    // A changed schedule changes when, or whether, this start happens.
    pin: [existing.status, existing.statusUpdateSchedule ?? null, queued.pin],
  });

  // Bandits manage their own update cadence; they don't use statusUpdateSchedule.
  const isBandit = existing.type === "multi-armed-bandit";
  const startAt =
    !isBandit && existing.statusUpdateSchedule?.startAt
      ? getValidDate(existing.statusUpdateSchedule.startAt)
      : null;
  const hasFutureSchedule = startAt && startAt > new Date();
  const alreadyStaged = !isBandit && !!existing.nextScheduledStatusUpdate;

  if (hasFutureSchedule && alreadyStaged) {
    throw new Error(
      "Experiment is already staged for a scheduled start. To start now, remove the schedule via the update experiment endpoint.",
    );
  }

  if (hasFutureSchedule && !alreadyStaged && startAt) {
    const { experiment, updated } = await approveScheduledExperimentStart({
      context,
      experimentId: req.params.id,
      skipChecklist: req.body?.skipChecklist,
      // By authority, as starting now is; the job asks again when it fires.
      bypassApproval: true,
    });

    await req.audit({
      event: "experiment.update",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsUpdate(experiment, updated),
    });

    const apiExperiment = await toEnhancedExperimentApiResponse(
      req.context,
      updated as ExperimentInterfaceExcludingHoldouts,
    );

    return {
      experiment: apiExperiment,
      message: `Experiment had a schedule set for a future date and was successfully staged to start on ${formatScheduledStartUtc(
        startAt,
      )}`,
    };
  }

  await validateExperimentChange({
    context,
    experiment: existing,
    changes: { status: "running" },
  });

  const { experiment, updated } = await startExperiment({
    context,
    experimentId: req.params.id,
    skipChecklist: req.body?.skipChecklist,
    // Like a Feature Revision publish: approval is bypassed by authority, not
    // by asking. `bypassApproval` in the body is accepted and ignored.
    bypassLockdown:
      canUseRestApiBypassSetting(req) ||
      context.permissions.canBypassFlagApprovalChecks(existing, "feature"),
    restApiBypassesReviews: canUseRestApiBypassSetting(req),
  });

  await req.audit({
    event: "experiment.start",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  const apiExperiment = await toEnhancedExperimentApiResponse(
    req.context,
    updated as ExperimentInterfaceExcludingHoldouts,
  );
  return {
    experiment: apiExperiment,
  };
});
