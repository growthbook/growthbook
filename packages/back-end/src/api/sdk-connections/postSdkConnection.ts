import { PostSdkConnectionResponse } from "../../../types/openapi";
import {
  toApiSDKConnectionInterface,
  createSDKConnection,
} from "../../models/SdkConnectionModel";
import { createApiRequestHandler } from "../../util/handler";
import { postSdkConnectionValidator } from "../../validators/openapi";
import { validatePayload } from "./validations";

export const postSdkConnection = createApiRequestHandler(
  postSdkConnectionValidator
)(
  async (req): Promise<PostSdkConnectionResponse> => {
    const sdkConnection = await createSDKConnection({
      ...(await validatePayload(req.context, req.body)),
      organization: req.context.org.id,
    });

    return {
      sdkConnection: toApiSDKConnectionInterface(sdkConnection),
    };
  }
);
