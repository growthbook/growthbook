import { GetSdkConnectionResponse } from "../../../types/openapi";
import {
  findSDKConnectionById,
  toApiSDKConnectionInterface,
} from "../../models/SdkConnectionModel";
import { createApiRequestHandler } from "../../util/handler";
import { getSdkConnectionValidator } from "../../validators/openapi";

export const getSdkConnection = createApiRequestHandler(
  getSdkConnectionValidator
)(
  async (req): Promise<GetSdkConnectionResponse> => {
    const sdkConnection = await findSDKConnectionById(
      req.params.id,
      req.readAccessFilter
    );
    if (!sdkConnection) {
      throw new Error("Could not find sdkConnection with that id");
    }

    return {
      sdkConnection: toApiSDKConnectionInterface(sdkConnection),
    };
  }
);
