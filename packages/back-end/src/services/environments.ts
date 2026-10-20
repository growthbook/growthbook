import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { countSDKConnectionsByEnvironment } from "back-end/src/models/SdkConnectionModel";
import { removeEnvironmentFromSlackIntegration } from "back-end/src/models/SlackIntegrationModel";
import { BadRequestError } from "back-end/src/util/errors";

// Single source of truth for "may this environment be deleted?", shared by the
// dashboard controller and the REST handler. Org-wide, like
// assertSavedGroupDeletable: an SDK Connection the caller cannot read is still
// left pointing at a missing environment by the delete.
export async function assertEnvironmentDeletable(
  context: ReqContext | ApiReqContext,
  environmentId: string,
): Promise<void> {
  const count = await countSDKConnectionsByEnvironment(context, environmentId);
  if (count === 0) return;
  throw new BadRequestError(
    `Cannot delete environment: it is still used by ${count} SDK Connection(s). Remove them or move them to another environment first.`,
  );
}

// Notification filters are derived config, not a dependency: prune, never block.
export async function cleanupDeletedEnvironment(
  organizationId: string,
  environmentId: string,
): Promise<void> {
  await removeEnvironmentFromSlackIntegration({
    organizationId,
    envId: environmentId,
  });
}
