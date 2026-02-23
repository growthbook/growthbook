import { PostSdkConnectionResponse } from "shared/types/openapi";
import { postSdkConnectionValidator } from "shared/validators";
import {
  toApiSDKConnectionInterface,
  createSDKConnection,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { validatePostPayload } from "./validations";

export const postSdkConnection = createApiRequestHandler(
  postSdkConnectionValidator,
)(async (req): Promise<PostSdkConnectionResponse> => {
  const params = {
    ...(await validatePostPayload(req.context, req.body)),
    organization: req.context.org.id,
  };

  if (!req.context.permissions.canCreateSDKConnection(params))
    req.context.permissions.throwPermissionError();

  const connection = await createSDKConnection(req.context, params);

  return {
    sdkConnection: toApiSDKConnectionInterface(connection),
  };
});
