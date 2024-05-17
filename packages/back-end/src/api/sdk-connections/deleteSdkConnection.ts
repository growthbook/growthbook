import { DeleteSdkConnectionResponse } from "../../../types/openapi";
import {
  findSDKConnectionById,
  deleteSDKConnectionById,
} from "../../models/SdkConnectionModel";
import { createApiRequestHandler } from "../../util/handler";
import { deleteSdkConnectionValidator } from "../../validators/openapi";

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
      throw new Error(
        "You don't have permission to delete this SDK connection!"
      );

    await deleteSDKConnectionById(req.context.org.id, sdkConnection.id);

    return {
      deletedId: req.params.id,
    };
  }
);
