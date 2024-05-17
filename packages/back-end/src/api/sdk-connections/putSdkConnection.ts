import { PutSdkConnectionResponse } from "../../../types/openapi";
import {
  findSDKConnectionById,
  toApiSDKConnectionInterface,
  editSDKConnection,
} from "../../models/SdkConnectionModel";
import { createApiRequestHandler } from "../../util/handler";
import { putSdkConnectionValidator } from "../../validators/openapi";
import { validatePayload } from "./validations";

export const putSdkConnection = createApiRequestHandler(
  putSdkConnectionValidator
)(
  async (req): Promise<PutSdkConnectionResponse> => {
    const sdkConnection = await findSDKConnectionById(
      req.context,
      req.params.id
    );
    if (!sdkConnection) {
      throw new Error("Could not find sdkConnection with that id");
    }

    const updatedSdkConnection = await editSDKConnection(
      req.context,
      sdkConnection,
      await validatePayload(req.context, { ...sdkConnection, ...req.body })
    );

    return {
      sdkConnection: toApiSDKConnectionInterface(updatedSdkConnection),
    };
  }
);
