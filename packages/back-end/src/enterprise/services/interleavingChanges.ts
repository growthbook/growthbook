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

  // Each start opens a new run rather than extending the old window. Tracking
  // keys may be reused once an experiment stops, so a window spanning the
  // dormant gap would also pull in whatever ran under the same key meanwhile.
  // dateStarted stays at the first run for display.
  const now = new Date();
  const updated = await context.models.interleavings.update(interleaving, {
    status: "running",
    dateStarted: interleaving.dateStarted ?? now,
    dateStopped: undefined,
    runs: [...interleaving.runs, { dateStarted: now }],
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

  const stoppedAt = new Date();
  const runs = [...interleaving.runs];
  const open = runs.length - 1;
  if (open >= 0 && !runs[open].dateEnded) {
    runs[open] = { ...runs[open], dateEnded: stoppedAt };
  }
  const updated = await context.models.interleavings.update(interleaving, {
    status: "stopped",
    dateStopped: stoppedAt,
    runs,
  });
  await context.auditLog({
    event: "interleaving.stop",
    entity: { object: "interleaving", id: interleaving.id },
    details: auditDetailsUpdate(interleaving, updated),
  });
  return updated;
}
