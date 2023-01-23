import type { Response } from "express";
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
  const { org } = getOrgFromReq(req);
  const connections = await findSDKConnectionsByOrganization(org.id);
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

  req.checkPermissions("manageEnvironments", params.project, [
    params.environment,
  ]);

  const doc = await createSDKConnection({ ...params, organization: org.id });

  res.status(200).json({
    status: 200,
    connection: doc,
  });
};

export const putSDKConnection = async (
  req: AuthRequest<EditSDKConnectionParams, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const connection = await findSDKConnectionById(id);

  if (!connection || connection.organization !== org.id) {
    throw new Error("Could not find SDK Connection");
  }

  req.checkPermissions(
    "manageEnvironments",
    [connection.project, req.body.project || ""],
    [connection.environment]
  );

  await editSDKConnection(connection, req.body);

  res.status(200).json({
    status: 200,
  });
};

export const deleteSDKConnection = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const { id } = req.params;
  const { org } = getOrgFromReq(req);
  const connection = await findSDKConnectionById(id);

  if (!connection || connection.organization !== org.id) {
    throw new Error("Could not find SDK Connection");
  }

  req.checkPermissions("manageEnvironments", connection.project, [
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
  const { org } = getOrgFromReq(req);
  const connection = await findSDKConnectionById(id);

  if (!connection || connection.organization !== org.id) {
    throw new Error("Could not find SDK Connection");
  }

  const result = await testProxyConnection(connection);

  res.status(200).json({
    status: 200,
    result,
  });
};
