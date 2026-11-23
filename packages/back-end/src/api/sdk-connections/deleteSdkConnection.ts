import { deleteSdkConnectionValidator } from "shared/validators";
import { PermissionError } from "shared/util";
import {
  findSDKConnectionById,
  deleteSDKConnectionModel,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";

export const deleteSdkConnection = createApiRequestHandler(
  deleteSdkConnectionValidator,
)(async (req) => {
  const sdkConnection = await findSDKConnectionById(req.context, req.params.id);
  if (!sdkConnection) {
    throw new NotFoundError("Could not find sdkConnection with that id");
  }

  if (!req.context.permissions.canDeleteSDKConnection(sdkConnection)) {
    req.context.permissions.throwPermissionError();
  }

  // Archiving takes a connection out of service, in a draft when its changes
  // need review. As for Feature Flags, a live one deletes only when the org
  // has opted in to unrestricted REST writes.
  if (!sdkConnection.archived && !canUseRestApiBypassSetting(req)) {
    throw new PermissionError(
      "Cannot delete a live SDK Connection via the REST API when 'REST API always bypasses approval requirements' is disabled. " +
        "Archive the SDK Connection first (`PUT /sdk-connections/{id}` with `archived: true`, or in a draft revision), or enable the bypass setting in organization settings.",
    );
  }

  await deleteSDKConnectionModel(req.context, sdkConnection);

  return { deletedId: req.params.id };
});
