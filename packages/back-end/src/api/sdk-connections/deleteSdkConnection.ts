import { DeleteSdkConnectionResponse } from "back-end/types/openapi";
import {
  findSDKConnectionById,
  deleteSDKConnectionById,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteSdkConnectionValidator } from "back-end/src/validators/openapi";
import { auditDetailsDelete } from "back-end/src/services/audit";
import { findAllSdkWebhooksByConnection, deleteSdkWebhookById } from "back-end/src/models/WebhookModel";

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
      req.context.permissions.throwPermissionError();

     // Fetch and delete associated webhooks
     const webhooks = await findAllSdkWebhooksByConnection(req.context, sdkConnection.id);
     for (const webhook of webhooks) {
       await deleteSdkWebhookById(req.context, webhook.id);
     }

    await deleteSDKConnectionById(req.context.org.id, sdkConnection.id);

    await req.audit({
      event: "sdk-connection.delete",
      entity: {
        object: "sdk-connection",
        id: sdkConnection.id,
      },
      details: auditDetailsDelete(sdkConnection),
    });

    return {
      deletedId: req.params.id,
    };
  }
);
