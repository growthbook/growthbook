import { deleteSdkConnectionValidator } from "shared/validators";
import {
  findSDKConnectionById,
  deleteSDKConnectionModel,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { isSdkConnectionGated } from "back-end/src/services/sdkConnectionApprovals";

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

  // Under an approval rule, a live connection can only be deleted when the org
  // has opted into unrestricted REST writes; otherwise archive it first.
  if (
    !sdkConnection.archived &&
    isSdkConnectionGated(req.context, sdkConnection) &&
    !canUseRestApiBypassSetting(req)
  ) {
    throw new BadRequestError(
      "Cannot delete a live SDK connection via the REST API when 'REST API always bypasses approval requirements' is disabled. " +
        "Archive the SDK connection first, or enable the bypass setting in organization settings.",
    );
  }

  await deleteSDKConnectionModel(req.context, sdkConnection);

  return {
    deletedId: req.params.id,
  };
});
