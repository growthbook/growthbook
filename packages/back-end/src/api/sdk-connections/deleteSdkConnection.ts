import { DeleteSdkConnectionResponse } from "shared/types/openapi";
import { deleteSdkConnectionValidator } from "shared/validators";
import {
  findSDKConnectionById,
  deleteSDKConnectionModel,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteSdkConnection = createApiRequestHandler(
  deleteSdkConnectionValidator,
)(async (req): Promise<DeleteSdkConnectionResponse> => {
  const sdkConnection = await findSDKConnectionById(req.context, req.params.id);
  if (!sdkConnection) {
    throw new Error("Could not find sdkConnection with that id");
  }

  if (!req.context.permissions.canDeleteSDKConnection(sdkConnection)) {
    req.context.permissions.throwPermissionError();
  }

  await deleteSDKConnectionModel(req.context, sdkConnection);

  return {
    deletedId: req.params.id,
  };
});
