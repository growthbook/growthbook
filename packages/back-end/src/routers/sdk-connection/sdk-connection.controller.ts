import type { Response } from "express";
import { orgHasPremiumFeature } from "enterprise";
import { AuthRequest } from "../../types/AuthRequest";
import { getOrgFromReq } from "../../services/organizations";
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
  const { org, readAccessFilter } = getOrgFromReq(req);

  const connections = await findSDKConnectionsByOrganization(
    org.id,
    readAccessFilter
  );

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
  const { org } = getOrgFromReq(req);
  const params = req.body;

  req.checkPermissions("manageEnvironments", params.projects, [
    params.environment,
  ]);

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
  const { org, readAccessFilter } = getOrgFromReq(req);
  const { id } = req.params;
  const connection = await findSDKConnectionById(id, readAccessFilter);

  if (!connection || connection.organization !== org.id) {
    throw new Error("Could not find SDK Connection");
  }

  const projects = [...connection.projects, ...(req.body.projects || [])];

  req.checkPermissions("manageEnvironments", projects, [
    connection.environment,
  ]);

  let encryptPayload = req.body.encryptPayload || false;
  const encryptionPermitted = orgHasPremiumFeature(
    org,
    "encrypt-features-endpoint"
  );
  const changingFromUnencryptedToEncrypted =
    !connection.encryptPayload && encryptPayload;
  if (changingFromUnencryptedToEncrypted && !encryptionPermitted) {
    encryptPayload = false;
  }

  let hashSecureAttributes = false;
  if (orgHasPremiumFeature(org, "hash-secure-attributes")) {
    hashSecureAttributes = req.body.hashSecureAttributes || false;
  }

  let remoteEvalEnabled = false;
  if (orgHasPremiumFeature(org, "remote-evaluation")) {
    remoteEvalEnabled = req.body.remoteEvalEnabled || false;
  }

  if (remoteEvalEnabled) {
    encryptPayload = false;
    hashSecureAttributes = false;
  }

  await editSDKConnection(connection, {
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
  const { org, readAccessFilter } = getOrgFromReq(req);
  const connection = await findSDKConnectionById(id, readAccessFilter);

  if (!connection || connection.organization !== org.id) {
    throw new Error("Could not find SDK Connection");
  }

  req.checkPermissions("manageEnvironments", connection.projects, [
    connection.environment,
  ]);

  await deleteSDKConnectionById(org.id, id);

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
  const { org, readAccessFilter } = getOrgFromReq(req);
  const connection = await findSDKConnectionById(id, readAccessFilter);

  if (!connection || connection.organization !== org.id) {
    throw new Error("Could not find SDK Connection");
  }

  const result = await testProxyConnection(connection);

  res.status(200).json({
    status: 200,
    result,
  });
};
