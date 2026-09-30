import { putSdkConnectionValidator } from "shared/validators";
import {
  findSDKConnectionById,
  toApiSDKConnectionInterface,
  editSDKConnection,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { validatePutPayload } from "./validations";

export const putSdkConnection = createApiRequestHandler(
  putSdkConnectionValidator,
)(async (req) => {
  const sdkConnection = await findSDKConnectionById(req.context, req.params.id);
  if (!sdkConnection) {
    throw new Error("Could not find sdkConnection with that id");
  }

  const params = await validatePutPayload(req.context, req.body, sdkConnection);

  if (!req.context.permissions.canUpdateSDKConnection(sdkConnection, params))
    req.context.permissions.throwPermissionError();

  // Without this the approval flow is a UI-only speed bump: an API key could
  // edit an approval-protected connection with no review and no revision.
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
          "Open a draft from the SDK connection page, or use an API key whose " +
          "role holds the bypassApprovalSDKConnections permission.",
      );
    }
  }

  const updatedSdkConnection = await editSDKConnection(
    req.context,
    sdkConnection,
    params,
  );

  return {
    sdkConnection: toApiSDKConnectionInterface(updatedSdkConnection),
  };
});
