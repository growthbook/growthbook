import {
  deleteSdkWebhookValidator,
  listSdkConnectionWebhooksValidator,
  postSdkConnectionWebhookValidator,
  postSdkWebhookTestValidator,
  putSdkWebhookValidator,
} from "shared/validators";
import { WebhookInterface } from "shared/types/webhook";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  findSDKConnectionById,
  findSDKConnectionsByIds,
} from "back-end/src/models/SdkConnectionModel";
import { fireSdkWebhook } from "back-end/src/jobs/sdkWebhooks";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";

function toApiSdkWebhook(w: WebhookInterface, canSeeSigningKey: boolean) {
  return {
    id: w.id,
    name: w.name,
    endpoint: w.endpoint,
    sdkConnections: w.sdks,
    httpMethod: w.httpMethod ?? "POST",
    payloadFormat: w.payloadFormat ?? "standard",
    payloadKey: w.payloadKey,
    headers: w.headers ?? "",
    signingKey: canSeeSigningKey ? w.signingKey : "",
    lastSuccess: w.lastSuccess?.toISOString() ?? null,
    error: w.error,
    consecutiveFailures: w.consecutiveFailures ?? 0,
    disabled: !!w.disabled,
    dateCreated: w.dateCreated.toISOString(),
    dateUpdated: w.dateUpdated.toISOString(),
  };
}

function assertHeadersJson(context: ApiReqContext, headers?: string) {
  if (!headers) return;
  try {
    JSON.parse(headers);
  } catch (e) {
    context.throwBadRequestError("headers must be a JSON-encoded object");
  }
}

async function getConnection(context: ApiReqContext, id: string) {
  const conn = await findSDKConnectionById(context, id);
  if (!conn) context.throwNotFoundError(`SDK Connection not found: ${id}`);
  return conn;
}

// Webhooks can span connections, so every one of them must allow the action.
async function getWebhookForUpdate(
  context: ApiReqContext,
  id: string,
  can: (conn: SDKConnectionInterface) => boolean,
) {
  const webhook = await context.models.sdkWebhooks.getById(id);
  if (!webhook) context.throwNotFoundError(`SDK webhook not found: ${id}`);
  const conns = await findSDKConnectionsByIds(context, webhook.sdks);
  if (!conns.every(can)) context.permissions.throwPermissionError();
  return { webhook, conns };
}

export const listSdkConnectionWebhooks = createApiRequestHandler(
  listSdkConnectionWebhooksValidator,
)(async (req) => {
  const conn = await getConnection(req.context, req.params.id);
  const webhooks =
    await req.context.models.sdkWebhooks.findAllSdkWebhooksByConnection(
      conn.id,
    );
  const canSeeSigningKey = req.context.permissions.canUpdateSDKWebhook(conn);
  return {
    sdkWebhooks: webhooks.map((w) => toApiSdkWebhook(w, canSeeSigningKey)),
  };
});

export const postSdkConnectionWebhook = createApiRequestHandler(
  postSdkConnectionWebhookValidator,
)(async (req) => {
  const { context } = req;
  const conn = await getConnection(context, req.params.id);
  if (!context.permissions.canCreateSDKWebhook(conn)) {
    context.permissions.throwPermissionError();
  }
  assertHeadersJson(context, req.body.headers);

  const count = await context.models.sdkWebhooks.countSdkWebhooksByOrg();
  if (
    count > 0 &&
    !orgHasPremiumFeature(context.org, "multiple-sdk-webhooks")
  ) {
    context.throwPlanDoesNotAllowError(
      "Your plan only supports one SDK webhook.",
    );
  }

  const webhook = await context.models.sdkWebhooks.create({
    ...context.models.sdkWebhooks.getDefaultCreateProps(conn.id),
    ...req.body,
    headers: req.body.headers ?? "",
  });
  return { sdkWebhook: toApiSdkWebhook(webhook, true) };
});

export const putSdkWebhook = createApiRequestHandler(putSdkWebhookValidator)(
  async (req) => {
    const { context } = req;
    const can = (c: SDKConnectionInterface) =>
      context.permissions.canUpdateSDKWebhook(c);
    const { webhook } = await getWebhookForUpdate(context, req.params.id, can);
    const { sdkConnections, ...updates } = req.body;
    assertHeadersJson(context, updates.headers);

    if (sdkConnections) {
      const next = await findSDKConnectionsByIds(context, sdkConnections);
      if (next.length !== new Set(sdkConnections).size) {
        context.throwBadRequestError(
          "Unknown SDK Connection in sdkConnections",
        );
      }
      if (!next.every(can)) context.permissions.throwPermissionError();
    }

    // Reset failure state when the endpoint changes, as the app does
    const resetFields =
      updates.endpoint && updates.endpoint !== webhook.endpoint
        ? { consecutiveFailures: 0, disabled: false }
        : {};
    const updated = await context.models.sdkWebhooks.update(webhook, {
      ...updates,
      ...(sdkConnections ? { sdks: sdkConnections } : {}),
      ...resetFields,
    });

    fireSdkWebhook(context, updated).catch(() => {
      // Already logged on the webhook
    });
    return { sdkWebhook: toApiSdkWebhook(updated, true) };
  },
);

export const deleteSdkWebhook = createApiRequestHandler(
  deleteSdkWebhookValidator,
)(async (req) => {
  const { context } = req;
  // Orphaned webhooks (no connections left) stay deletable
  await getWebhookForUpdate(context, req.params.id, (c) =>
    context.permissions.canDeleteSDKWebhook(c),
  );
  await context.models.sdkWebhooks.deleteById(req.params.id);
  return { deletedId: req.params.id };
});

export const postSdkWebhookTest = createApiRequestHandler(
  postSdkWebhookTestValidator,
)(async (req) => {
  const { context } = req;
  const { webhook, conns } = await getWebhookForUpdate(
    context,
    req.params.id,
    (c) => context.permissions.canUpdateSDKWebhook(c),
  );
  if (!conns.length) {
    context.throwBadRequestError(
      "Could not find any SDK Connection tied to this webhook",
    );
  }
  await fireSdkWebhook(context, webhook).catch(() => {
    // The outcome is recorded on the webhook
  });
  const after =
    (await context.models.sdkWebhooks.getById(webhook.id)) ?? webhook;
  return { sdkWebhook: toApiSdkWebhook(after, true) };
});
