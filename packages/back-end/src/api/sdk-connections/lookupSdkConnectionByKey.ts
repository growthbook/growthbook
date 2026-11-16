import { lookupSdkConnectionByKeyValidator } from "shared/validators";
import {
  findSDKConnectionByKeyForOrg,
  toApiSDKConnectionInterface,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const lookupSdkConnectionByKey = createApiRequestHandler(
  lookupSdkConnectionByKeyValidator,
)(async (req) => {
  const sdkConnection = await findSDKConnectionByKeyForOrg(
    req.context,
    req.params.key,
  );
  if (!sdkConnection) {
    throw new Error("Could not find sdkConnection with that key");
  }
  if (
    !req.context.permissions.canReadMultiProjectResource(sdkConnection.projects)
  )
    req.context.permissions.throwPermissionError();

  return {
    sdkConnection: toApiSDKConnectionInterface(sdkConnection),
  };
});
