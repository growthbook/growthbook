import { ContextualBanditInterface } from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { ApiReqContext } from "back-end/types/api";
import { getExperimentById } from "back-end/src/models/ExperimentModel";

/**
 * Shared lookup for the CB GET handlers: loads the CB doc, gates on the
 * project-scoped read permission, and surfaces the parent experiment via
 * the legacy FK so the existing snapshot / event collection methods
 * (which still key by experiment id) keep working through the decoupling
 * window. PR-8 refactors those collections to key by CB id and this
 * helper drops the experiment side.
 *
 * Throws via `req.context.throwNotFoundError` if either lookup fails so
 * callers don't have to handle the not-found shape themselves.
 */
export async function loadCbForRead(
  context: ApiReqContext,
  id: string,
): Promise<{
  cb: ContextualBanditInterface;
  experiment: ExperimentInterface | null;
}> {
  if (!context.hasPremiumFeature("contextual-bandits")) {
    context.throwPlanDoesNotAllowError(
      "Contextual Bandits require an Enterprise plan.",
    );
  }
  const cb = await context.models.contextualBandits.getById(id);
  if (!cb) {
    return context.throwNotFoundError();
  }
  if (!context.permissions.canReadSingleProjectResource(cb.project)) {
    context.permissions.throwPermissionError();
  }
  // Legacy bridge — `experiment` may be undefined post-PR-8 once the FK is
  // dropped, in which case the snapshot / event lookups return empty
  // results and the GET endpoints respond with empty lists / nulls.
  const experiment = cb.experiment
    ? await getExperimentById(context, cb.experiment)
    : null;
  return { cb, experiment };
}
