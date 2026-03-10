import { PutSdkConnectionResponse } from "shared/types/openapi";
import { putSdkConnectionValidator } from "shared/validators";
import {
  findSDKConnectionById,
  toApiSDKConnectionInterface,
  editSDKConnection,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { validatePutPayload } from "./validations";

export const putSdkConnection = createApiRequestHandler(
  putSdkConnectionValidator,
)(async (req): Promise<PutSdkConnectionResponse> => {
  const sdkConnection = await findSDKConnectionById(req.context, req.params.id);
  if (!sdkConnection) {
    throw new Error("Could not find sdkConnection with that id");
  }

  const params = await validatePutPayload(req.context, req.body, sdkConnection);

  if (!req.context.permissions.canUpdateSDKConnection(sdkConnection, params))
    req.context.permissions.throwPermissionError();

  const updatedSdkConnection = await editSDKConnection(
    req.context,
    sdkConnection,
    params,
  );

  return {
    sdkConnection: toApiSDKConnectionInterface(updatedSdkConnection),
  };
});
