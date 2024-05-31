import { PostSdkConnectionResponse } from "../../../types/openapi";
import {
  toApiSDKConnectionInterface,
  createSDKConnection,
} from "../../models/SdkConnectionModel";
import { createApiRequestHandler } from "../../util/handler";
import { postSdkConnectionValidator } from "../../validators/openapi";
import { auditDetailsCreate } from "../../services/audit";
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
