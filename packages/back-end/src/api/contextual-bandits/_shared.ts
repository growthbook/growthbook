import { ContextualBanditInterface } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";

export async function loadContextualBanditForRead(
  context: ApiReqContext,
  id: string,
): Promise<{ contextualBandit: ContextualBanditInterface }> {
  if (!context.hasPremiumFeature("contextual-bandits")) {
    context.throwPlanDoesNotAllowError(
      "Contextual Bandits require an Enterprise plan.",
    );
  }
  const contextualBandit = await context.models.contextualBandits.getById(id);
  if (!contextualBandit) {
    return context.throwNotFoundError();
  }
  if (
    !context.permissions.canReadSingleProjectResource(contextualBandit.project)
  ) {
    context.permissions.throwPermissionError();
  }
  return { contextualBandit };
}
