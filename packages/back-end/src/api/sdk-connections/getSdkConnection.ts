import { getSdkConnectionValidator } from "shared/validators";
import {
  findSDKConnectionById,
  toApiSDKConnectionInterface,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

export const getSdkConnection = createApiRequestHandler(
  getSdkConnectionValidator,
)(async (req) => {
  const sdkConnection = await findSDKConnectionById(req.context, req.params.id);
  if (!sdkConnection) {
    throw new NotFoundError("Could not find sdkConnection with that id");
  }

  return {
    sdkConnection: toApiSDKConnectionInterface(sdkConnection),
  };
});
