import { HoldoutInterface } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";

// A Holdout with no Projects is global; otherwise the linked entity's Project
// must be one of them.
export function isHoldoutAvailableForProject(
  holdout: Pick<HoldoutInterface, "projects">,
  project: string | undefined,
): boolean {
  return (
    holdout.projects.length === 0 ||
    (!!project && holdout.projects.includes(project))
  );
}

export function assertHoldoutAvailableForProject(
  holdout: Pick<HoldoutInterface, "projects" | "name">,
  project: string | undefined,
): void {
  if (!isHoldoutAvailableForProject(holdout, project)) {
    throw new BadRequestError(
      `Holdout "${holdout.name}" is not available in the selected Project.`,
    );
  }
}

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
    // Also the read-scope failure mode: an unreadable Holdout is indistinguishable
    // from a missing one, deliberately.
    throw new NotFoundError("Holdout not found");
  }

  assertHoldoutAvailableForProject(holdout, project);
  return holdout;
}
