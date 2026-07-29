import { HoldoutInterface } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";

export async function getHoldoutAvailableForProject({
  context,
  holdoutId,
  project,
  bypassReadPermissionChecks = false,
}: {
  context: ReqContext | ApiReqContext;
  holdoutId: string;
  project: string | undefined;
  bypassReadPermissionChecks?: boolean;
}): Promise<HoldoutInterface> {
  const holdout = bypassReadPermissionChecks
    ? await context.models.holdout.getByIdForLinkage(holdoutId)
    : await context.models.holdout.getById(holdoutId);
  if (!holdout) {
    throw new Error("Holdout not found");
  }

  const available =
    holdout.projects.length === 0 ||
    (!!project && holdout.projects.includes(project));
  if (!available) {
    throw new Error(
      `Holdout "${holdout.name}" is not available in the selected Project.`,
    );
  }
  return holdout;
}
