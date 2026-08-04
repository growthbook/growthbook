import { holdsMoveDestination, RevisionModel } from "shared/permissions";
import { proposedProjectScope } from "shared/util";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

type PermissionsUtil = ReturnType<typeof usePermissionsUtil>;

type ProjectScoped = { project?: string; projects?: string[] };

/**
 * Whether the viewer may LAND the selected revision.
 *
 * The live entity's own project answers the wrong question when the revision
 * relocates the entity: landing it is a write to the destination, so authority
 * there is required too. Asking only about the source offered a Publish button
 * the endpoint then refused.
 *
 * Runs the same `holdsMoveDestination` the server does, so the button and the
 * endpoint cannot disagree.
 */
export function canPublishRevisionEntity(
  permissionsUtil: PermissionsUtil,
  model: RevisionModel,
  revision: { target?: { proposedChanges?: unknown } } | null | undefined,
  liveEntity: ProjectScoped,
  environments: string[],
): boolean {
  if (
    !permissionsUtil.canRevisionAction(
      model,
      "publish",
      liveEntity,
      environments,
    )
  ) {
    return false;
  }
  return holdsMoveDestination({
    permissions: permissionsUtil,
    model,
    action: "publish",
    existing: liveEntity,
    proposed: {
      ...liveEntity,
      ...proposedProjectScope(revision?.target?.proposedChanges),
    },
    environments,
  });
}
