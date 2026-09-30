import { deleteSdkConnectionValidator } from "shared/validators";
import {
  findSDKConnectionById,
  deleteSDKConnectionModel,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";

export const deleteSdkConnection = createApiRequestHandler(
  deleteSdkConnectionValidator,
)(async (req) => {
  const sdkConnection = await findSDKConnectionById(req.context, req.params.id);
  if (!sdkConnection) {
    throw new Error("Could not find sdkConnection with that id");
  }

  if (!req.context.permissions.canDeleteSDKConnection(sdkConnection)) {
    req.context.permissions.throwPermissionError();
  }

  // Same archive-before-delete rule the interactive route enforces: deleting a
  // live connection takes an SDK offline with no staged, reviewable step.
  if (!sdkConnection.archived) {
    throw new BadRequestError("Archive the SDK connection before deleting it.");
  }

  const adapter = getAdapter("sdk-connection");
  if (adapter.isApprovalRequired(req.context)) {
    const canBypass =
      canUseRestApiBypassSetting(req) ||
      req.context.permissions.canBypassSDKConnectionApprovalChecks({
        projects: sdkConnection.projects,
      });
    if (!canBypass) {
      throw new BadRequestError(
        "This organization requires approvals on SDK connections. " +
          "Archive and delete through a draft, or use an API key whose role " +
          "holds the bypassApprovalSDKConnections permission.",
      );
    }
  }

  await deleteSDKConnectionModel(req.context, sdkConnection);

  return {
    deletedId: req.params.id,
  };
});
