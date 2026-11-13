import { deleteSdkConnectionValidator } from "shared/validators";
import {
  findSDKConnectionById,
  deleteSDKConnectionModel,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  ARCHIVE_BEFORE_DELETE,
  assertDirectWriteAllowed,
} from "back-end/src/services/sdkConnectionApprovals";

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

  // Under an approval rule, archiving is the reviewable step.
  const bypassedGates = sdkConnection.archived
    ? []
    : assertDirectWriteAllowed(
        req.context,
        [sdkConnection],
        {
          bypassApproval: req.body?.bypassApproval,
          restBypass: canUseRestApiBypassSetting(req),
        },
        ARCHIVE_BEFORE_DELETE,
      );

  await deleteSDKConnectionModel(req.context, sdkConnection);

  return {
    deletedId: req.params.id,
    ...(bypassedGates.length ? { bypassedGates } : {}),
  };
});
