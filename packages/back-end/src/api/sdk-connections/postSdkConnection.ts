import { postSdkConnectionValidator } from "shared/validators";
import {
  toApiSDKConnectionInterface,
  createSDKConnection,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ensureLiveRevisionExists } from "back-end/src/revisions/util";
import { validatePostPayload } from "./validations";

export const postSdkConnection = createApiRequestHandler(
  postSdkConnectionValidator,
)(async (req) => {
  const params = {
    ...(await validatePostPayload(req.context, req.body)),
    organization: req.context.org.id,
  };

  if (!req.context.permissions.canCreateSDKConnection(params))
    req.context.permissions.throwPermissionError();

  const connection = await createSDKConnection(req.context, params);
  // Baseline for history and later edits, as the app records one.
  await ensureLiveRevisionExists(req.context, "sdk-connection", {
    ...connection,
    _webhooks: [],
  });

  return {
    sdkConnection: toApiSDKConnectionInterface(connection),
  };
});
