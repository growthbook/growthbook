import { DeleteSdkConnectionResponse } from "../../../types/openapi";
import {
  findSDKConnectionById,
  deleteSDKConnectionById,
} from "../../models/SdkConnectionModel";
import { createApiRequestHandler } from "../../util/handler";
import { deleteSdkConnectionValidator } from "../../validators/openapi";
import { auditDetailsDelete } from "../../services/audit";

export const deleteSdkConnection = createApiRequestHandler(
  deleteSdkConnectionValidator
)(
  async (req): Promise<DeleteSdkConnectionResponse> => {
    const sdkConnection = await findSDKConnectionById(
      req.context,
      req.params.id
    );
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
  }
);
