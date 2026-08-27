import { InterleavingInterface } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";

export async function loadInterleavingForRead(
  context: ApiReqContext,
  id: string,
): Promise<{ interleaving: InterleavingInterface }> {
  if (!context.hasPremiumFeature("interleaving")) {
    context.throwPlanDoesNotAllowError(
      "Interleaving experiments require an Enterprise plan.",
    );
  }
  const interleaving = await context.models.interleavings.getById(id);
  if (!interleaving) {
    return context.throwNotFoundError();
  }
  if (!context.permissions.canReadSingleProjectResource(interleaving.project)) {
    context.permissions.throwPermissionError();
  }
  return { interleaving };
}
