import type { Response } from "express";
import { pick } from "lodash";
import {
  SDKConnectionInterface,
  CreateSDKConnectionParams,
  EditSDKConnectionParams,
  ProxyTestResult,
} from "shared/types/sdk-connection";
import {
  CreateSdkWebhookProps,
  WebhookInterface,
  WebhookSummary,
} from "shared/types/webhook";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { triggerSingleSDKWebhookJobs } from "back-end/src/jobs/updateAllJobs";
import {
  countSdkWebhooksByOrg,
  createSdkWebhook,
  findAllSdkWebhooksByConnection,
  findAllSdkWebhooksByConnectionIds,
} from "back-end/src/models/WebhookModel";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  createSDKConnection,
  deleteSDKConnectionById,
  editSDKConnection,
  findSDKConnectionById,
  findSDKConnectionsByOrganization,
  testProxyConnection,
} from "back-end/src/models/SdkConnectionModel";

export const getSDKConnections = async (
  req: AuthRequest,
  res: Response<{
    status: 200;
    connections: SDKConnectionInterface[];
  }>,
) => {
  const context = getContextFromReq(req);
  const connections = await findSDKConnectionsByOrganization(context);
  res.status(200).json({
    status: 200,
    connections,
  });
};

export const postSDKConnection = async (
  req: AuthRequest<Omit<CreateSDKConnectionParams, "organization">>,
  res: Response<{
    status: 200;
    connection: SDKConnectionInterface;
  }>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const params = req.body;

  if (!context.permissions.canCreateSDKConnection(params)) {
    context.permissions.throwPermissionError();
  }

  let encryptPayload = false;
  if (orgHasPremiumFeature(org, "encrypt-features-endpoint")) {
    encryptPayload = params.encryptPayload;
  }

  let hashSecureAttributes = false;
  if (orgHasPremiumFeature(org, "hash-secure-attributes")) {
    hashSecureAttributes = params.hashSecureAttributes;
  }

  let remoteEvalEnabled = false;
  if (orgHasPremiumFeature(org, "remote-evaluation")) {
    remoteEvalEnabled = params.remoteEvalEnabled || false;
  }

  if (remoteEvalEnabled) {
    encryptPayload = false;
    hashSecureAttributes = false;
  }

  const doc = await createSDKConnection({
    ...params,
    encryptPayload,
    hashSecureAttributes,
    remoteEvalEnabled,
    organization: org.id,
  });
  const isUsingProxy = !!(doc.proxy.enabled && doc.proxy.host);
  triggerSingleSDKWebhookJobs(context, doc, {}, doc.proxy, isUsingProxy);
  res.status(200).json({
    status: 200,
    connection: doc,
  });
};

export const putSDKConnection = async (
  req: AuthRequest<EditSDKConnectionParams, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const connection = await findSDKConnectionById(context, id);

  if (!connection) {
    throw new Error("Could not find SDK Connection");
  }

  if (!context.permissions.canUpdateSDKConnection(connection, req.body)) {
    context.permissions.throwPermissionError();
  }

  let encryptPayload = req.body.encryptPayload || false;
  const encryptionPermitted = orgHasPremiumFeature(
    context.org,
    "encrypt-features-endpoint",
  );
  const changingFromUnencryptedToEncrypted =
    !connection.encryptPayload && encryptPayload;
  if (changingFromUnencryptedToEncrypted && !encryptionPermitted) {
    encryptPayload = false;
  }

  let hashSecureAttributes = false;
  if (orgHasPremiumFeature(context.org, "hash-secure-attributes")) {
    hashSecureAttributes = req.body.hashSecureAttributes || false;
  }

  let remoteEvalEnabled = false;
  if (orgHasPremiumFeature(context.org, "remote-evaluation")) {
    remoteEvalEnabled = req.body.remoteEvalEnabled || false;
  }

  if (remoteEvalEnabled) {
    encryptPayload = false;
    hashSecureAttributes = false;
  }

  await editSDKConnection(context, connection, {
    ...req.body,
    encryptPayload,
    hashSecureAttributes,
    remoteEvalEnabled,
  });
  res.status(200).json({
    status: 200,
  });
};

export const deleteSDKConnection = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);
  const connection = await findSDKConnectionById(context, id);

  if (!connection) {
    throw new Error("Could not find SDK Connection");
  }

  if (!context.permissions.canDeleteSDKConnection(connection)) {
    context.permissions.throwPermissionError();
  }

  await deleteSDKConnectionById(context.org.id, id);

  res.status(200).json({
    status: 200,
  });
};

export const checkSDKConnectionProxyStatus = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    result?: ProxyTestResult;
  }>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);
  const connection = await findSDKConnectionById(context, id);

  if (!connection) {
    throw new Error("Could not find SDK Connection");
  }

  const result = await testProxyConnection(connection);

  res.status(200).json({
    status: 200,
    result,
  });
};

export const getSDKConnectionsWebhooks = async (
  req: AuthRequest,
  res: Response<{
    status: 200;
    connections: Record<string, WebhookSummary[]>;
  }>,
) => {
  const context = getContextFromReq(req);
  const connections = await findSDKConnectionsByOrganization(context);
  const connectionIds = connections.map((conn) => conn.id);
  const allWebhooks = await findAllSdkWebhooksByConnectionIds(
    context,
    connectionIds,
  );

  const webhooksByConnection: Record<string, WebhookSummary[]> = {};

  allWebhooks.forEach((webhook) => {
    const webhookSummary = pick(webhook, [
      "id",
      "name",
      "endpoint",
      "lastSuccess",
      "error",
      "created",
    ]);
    webhook.sdks.forEach((sdkId) => {
      if (!webhooksByConnection[sdkId]) {
        webhooksByConnection[sdkId] = [];
      }
      webhooksByConnection[sdkId].push(webhookSummary);
    });
  });

  res.status(200).json({
    status: 200,
    connections: webhooksByConnection,
  });
};

export const getSDKConnectionWebhooks = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    webhooks: WebhookInterface[];
  }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const conn = await findSDKConnectionById(context, id);
  if (!conn) {
    throw new Error("Could not find SDK connection");
  }

  const webhooks = await findAllSdkWebhooksByConnection(context, id);

  // If user does not have write access, remove the shared secret
  if (!context.permissions.canUpdateSDKWebhook(conn)) {
    webhooks.forEach((w) => {
      w.signingKey = "";
    });
  }

  res.status(200).json({
    status: 200,
    webhooks,
  });
};

export async function postSDKConnectionWebhook(
  req: AuthRequest<CreateSdkWebhookProps, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const { id } = req.params;
  const connection = await findSDKConnectionById(context, id);
  if (!connection) {
    throw new Error("Could not find SDK Connection");
  }

  if (!context.permissions.canCreateSDKWebhook(connection)) {
    context.permissions.throwPermissionError();
  }

  const webhookcount = await countSdkWebhooksByOrg(org.id);
  const canAddMultipleSdkWebhooks = orgHasPremiumFeature(
    org,
    "multiple-sdk-webhooks",
  );
  if (!canAddMultipleSdkWebhooks && webhookcount > 0) {
    throw new Error("your webhook limit has been reached");
  }

  const webhook = await createSdkWebhook(context, id, req.body);
  return res.status(200).json({
    status: 200,
    webhook,
  });
}
