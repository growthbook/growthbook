import { z } from "zod";
import { GetSdkConnectionResponse } from "../../../types/openapi";
import {
  findSDKConnectionById,
  toApiSDKConnectionInterface,
} from "../../models/SdkConnectionModel";
import { createApiRequestHandler } from "../../util/handler";

export const getSdkConnection = createApiRequestHandler({
  paramsSchema: z
    .object({
      id: z.string(),
    })
    .strict(),
})(
  async (req): Promise<GetSdkConnectionResponse> => {
    const sdkConnection = await findSDKConnectionById(req.params.id);
    if (!sdkConnection) {
      throw new Error("Could not find sdkConnection with that id");
    }

    return {
      sdkConnection: toApiSDKConnectionInterface(sdkConnection),
    };
  }
);
