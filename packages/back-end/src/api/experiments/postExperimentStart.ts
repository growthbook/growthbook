import {
  ExperimentInterfaceExcludingHoldouts,
  postExperimentStartValidator,
} from "shared/validators";
import { getValidDate } from "shared/dates";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ReqContext } from "back-end/types/request";
import {
  approveScheduledExperimentStart,
  startExperiment,
  validateExperimentChange,
} from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
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
