import { getSdkConnectionValidator } from "@/src/validators/openapi";
import { GetSdkConnectionResponse } from "@/types/openapi";
import {
  findSDKConnectionById,
  toApiSDKConnectionInterface,
} from "@/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "@/src/util/handler";

export const getSdkConnection = createApiRequestHandler(
  getSdkConnectionValidator
)(
  async (req): Promise<GetSdkConnectionResponse> => {
    const sdkConnection = await findSDKConnectionById(
      req.context,
      req.params.id
    );
    if (!sdkConnection) {
      throw new Error("Could not find sdkConnection with that id");
    }

    return {
      sdkConnection: toApiSDKConnectionInterface(sdkConnection),
    };
  }
);
