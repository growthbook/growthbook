import { PostSdkConnectionResponse } from "back-end/types/openapi";
import {
  toApiSDKConnectionInterface,
  createSDKConnection,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postSdkConnectionValidator } from "back-end/src/validators/openapi";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { validatePayload } from "./validations";

export const postSdkConnection = createApiRequestHandler(
  postSdkConnectionValidator
)(
  async (req): Promise<PostSdkConnectionResponse> => {
    const params = {
      ...(await validatePayload(req.context, req.body)),
      organization: req.context.org.id,
    };

    if (!req.context.permissions.canCreateSDKConnection(params))
      req.context.permissions.throwPermissionError();

    const connection = await createSDKConnection(params);

    await req.audit({
      event: "sdk-connection.create",
      entity: {
        object: "sdk-connection",
        id: connection.id,
      },
      details: auditDetailsCreate(connection),
    });

    return {
      sdkConnection: toApiSDKConnectionInterface(connection),
    };
  }
);
