import { GetSdkConnectionResponse } from "shared/types/openapi";
import { getSdkConnectionValidator } from "shared/validators";
import {
  findSDKConnectionById,
  toApiSDKConnectionInterface,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getSdkConnection = createApiRequestHandler(
  getSdkConnectionValidator,
)(async (req): Promise<GetSdkConnectionResponse> => {
  const sdkConnection = await findSDKConnectionById(req.context, req.params.id);
  if (!sdkConnection) {
    throw new Error("Could not find sdkConnection with that id");
  }

  return {
    sdkConnection: toApiSDKConnectionInterface(sdkConnection),
  };
});
