import type { Response } from "express";
import { orgHasPremiumFeature } from "enterprise";
import { WebhookInterface } from "@back-end/types/webhook";
import { findAllSdkWebhooksByConnection } from "@back-end/src/models/WebhookModel";
import { AuthRequest } from "../../types/AuthRequest";
import { getContextFromReq } from "../../services/organizations";
import {
  SDKConnectionInterface,
  CreateSDKConnectionParams,
  EditSDKConnectionParams,
  ProxyTestResult,
} from "../../../types/sdk-connection";
import {
  createSDKConnection,
  deleteSDKConnectionById,
  editSDKConnection,
  findSDKConnectionById,
  findSDKConnectionsByOrganization,
  testProxyConnection,
} from "../../models/SdkConnectionModel";

export const getSDKConnections = async (
  req: AuthRequest,
  res: Response<{
    status: 200;
    connections: SDKConnectionInterface[];
  }>
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
  }>
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

  res.status(200).json({
    status: 200,
    connection: doc,
  });
};

export const putSDKConnection = async (
  req: AuthRequest<EditSDKConnectionParams, { id: string }>,
  res: Response<{ status: 200 }>
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
    "encrypt-features-endpoint"
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
  res: Response<{ status: 200 }>
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
    result: ProxyTestResult;
  }>
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

export const getSDKConnectionWebhooks = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    webhooks: WebhookInterface[];
  }>
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const conn = await findSDKConnectionById(context, id);
  if (!conn) {
    throw new Error("Could not find SDK connection");
  }

  if (!context.permissions.canReadMultiProjectResource(conn.projects)) {
    context.permissions.throwPermissionError();
  }

  const webhooks = await findAllSdkWebhooksByConnection(context, id);

  res.status(200).json({
    status: 200,
    webhooks,
  });
};
