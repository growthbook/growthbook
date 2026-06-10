import { ContextualBanditInterface } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";

/** Load a CB by id with premium + project-scoped read permission checks. */
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
