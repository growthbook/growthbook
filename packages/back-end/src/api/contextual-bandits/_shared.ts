import { ContextualBanditInterface } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";

/**
 * Shared lookup for the CB GET handlers: loads the CB doc and gates on
 * the project-scoped read permission. Post-PR-8 the snapshot / event
 * collections key by CB id directly, so there is no parent-experiment
 * bridge to surface.
 *
 * Throws via `req.context.throwNotFoundError` if the CB lookup fails so
 * callers don't have to handle the not-found shape themselves.
 */
export async function loadCbForRead(
  context: ApiReqContext,
  id: string,
): Promise<{ cb: ContextualBanditInterface }> {
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
  return { cb };
}
