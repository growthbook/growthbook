import { DeleteSdkConnectionResponse } from "shared/types/openapi";
import { deleteSdkConnectionValidator } from "shared/validators";
import {
  findSDKConnectionById,
  deleteSDKConnectionById,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { auditDetailsDelete } from "back-end/src/services/audit";

export const deleteSdkConnection = createApiRequestHandler(
  deleteSdkConnectionValidator,
)(async (req): Promise<DeleteSdkConnectionResponse> => {
  const sdkConnection = await findSDKConnectionById(req.context, req.params.id);
  if (!sdkConnection) {
    throw new Error("Could not find sdkConnection with that id");
  }

  if (!req.context.permissions.canDeleteSDKConnection(sdkConnection))
    req.context.permissions.throwPermissionError();

  await deleteSDKConnectionById(req.context.org.id, sdkConnection.id);

  await req.audit({
    event: "sdk-connection.delete",
    entity: {
      object: "sdk-connection",
      id: sdkConnection.id,
    },
    details: auditDetailsDelete(sdkConnection),
  });

  return {
    deletedId: req.params.id,
  };
});
