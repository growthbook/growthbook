import { GetSdkConnectionResponse } from "back-end/types/openapi";
import {
  findSDKConnectionById,
  toApiSDKConnectionInterface,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getSdkConnectionValidator } from "back-end/src/validators/openapi";

export const getSdkConnection = createApiRequestHandler(
  getSdkConnectionValidator
)(async (req): Promise<GetSdkConnectionResponse> => {
  const sdkConnection = await findSDKConnectionById(req.context, req.params.id);
  if (!sdkConnection) {
    throw new Error("Could not find sdkConnection with that id");
  }

  return {
    sdkConnection: toApiSDKConnectionInterface(sdkConnection),
  };
});
