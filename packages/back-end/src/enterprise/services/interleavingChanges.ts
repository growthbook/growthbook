import type { InterleavingInterface } from "shared/validators";
import { interleavingEnvsForChange } from "shared/permissions";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { auditDetailsUpdate } from "back-end/src/services/audit";

type Context = ReqContext | ApiReqContext;

export async function startInterleaving(
  context: Context,
  interleaving: InterleavingInterface,
): Promise<InterleavingInterface> {
  if (interleaving.archived) {
    context.throwBadRequestError(
      "Unarchive this interleaving experiment before starting it.",
    );
  }
  if (interleaving.status === "running") return interleaving;
  if (
    !interleavingEnvsForChange({
      existing: interleaving,
      environmentIds: context.environments,
    }).length
  ) {
    context.throwBadRequestError(
      "Enable at least one environment before starting this interleaving experiment.",
    );
  }

  // A restart continues the original window, matching how experiments resume a
  // stopped phase (controllers/experiments.ts clears dateEnded and keeps
  // dateStarted). Bandits restart the window instead because their weights
  // adapt; interleaving's draft is fixed-seed, so continuing is safe and keeps
  // the pre-stop data. The dormant gap is included — phases would be the fix.
  const updated = await context.models.interleavings.update(interleaving, {
    status: "running",
    dateStarted: interleaving.dateStarted ?? new Date(),
    dateStopped: undefined,
  });
  await context.auditLog({
    event: "interleaving.start",
    entity: { object: "interleaving", id: interleaving.id },
    details: auditDetailsUpdate(interleaving, updated),
  });
  return updated;
}

export async function stopInterleaving(
  context: Context,
  interleaving: InterleavingInterface,
): Promise<InterleavingInterface> {
  if (interleaving.status === "stopped") return interleaving;
  if (interleaving.status !== "running") {
    context.throwBadRequestError(
      "Only a running interleaving experiment can be stopped.",
    );
  }

  const updated = await context.models.interleavings.update(interleaving, {
    status: "stopped",
    dateStopped: new Date(),
  });
  await context.auditLog({
    event: "interleaving.stop",
    entity: { object: "interleaving", id: interleaving.id },
    details: auditDetailsUpdate(interleaving, updated),
  });
  return updated;
}
