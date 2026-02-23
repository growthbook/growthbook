import { GetSdkConnectionResponse } from "shared/types/openapi";
import { lookupSdkConnectionByKeyValidator } from "shared/validators";
import {
  findSDKConnectionByKey,
  toApiSDKConnectionInterface,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const lookupSdkConnectionByKey = createApiRequestHandler(
  lookupSdkConnectionByKeyValidator,
)(async (req): Promise<GetSdkConnectionResponse> => {
  const sdkConnection = await findSDKConnectionByKey(req.params.key);
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
