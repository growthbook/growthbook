import fetch from "node-fetch";
import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { updateOrganization } from "../models/OrganizationModel";
import { getOrgFromReq } from "../services/organizations";
import { getAllApiKeysByOrganization } from "../models/ApiKeyModel";
import {
  GbVercelEnvMap,
  ApiKeyRow,
  VercelEnvVar,
  CreateEnvParams,
} from "../../types/vercel";
import {
  createOrgGbKeys,
  getEnvVars,
  getGbRelatedVercelProjects,
  postEnvVar,
  reduceGbVercelEnvMap,
} from "../services/vercel";
import {
  APP_ORIGIN,
  VERCEL_CLIENT_ID,
  VERCEL_CLIENT_SECRET,
} from "../util/secrets";
import { auditDetailsUpdate } from "../services/audit";

export async function getHasToken(req: AuthRequest, res: Response) {
  const { org } = await getOrgFromReq(req);
  res.status(200).json({ hasToken: !!org.connections?.vercel?.token });
}

export async function postToken(
  req: AuthRequest<{ code: string; configurationId: string; teamId: string }>,
  res: Response
) {
  req.checkPermissions("organizationSettings");
  const { code, configurationId, teamId } = req.body;
  const { org } = getOrgFromReq(req);

  const url = "https://api.vercel.com/v2/oauth/access_token";
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code: code,
      client_id: VERCEL_CLIENT_ID,
      client_secret: VERCEL_CLIENT_SECRET,
      redirect_uri: `${APP_ORIGIN}/integrations/vercel`,
    }),
  };

  const tokenRes = await fetch(url, options);
  const json = await tokenRes.json();
  if (json.error) throw new Error(json.error);

  const orig = org.connections?.vercel;
  const updatePayload = { token: json.access_token, configurationId, teamId };

  await updateOrganization(org.id, { connections: { vercel: updatePayload } });

  await req.audit({
    event: "organization.update",
    entity: {
      object: "organization",
      id: org.id,
    },
    details: auditDetailsUpdate(
      { connections: { vercel: { ...orig, token: "*********" } } },
      { connections: { vercel: { ...updatePayload, token: "*********" } } }
    ),
  });

  return res.status(200).json({ status: 200 });
}

export async function postEnvVars(
  req: AuthRequest<{ gbVercelEnvMap: GbVercelEnvMap }>,
  res: Response
) {
  req.checkPermissions("organizationSettings");
  const { gbVercelEnvMap } = req.body;
  const { org } = getOrgFromReq(req);

  if (!org.connections?.vercel)
    throw new Error("Vercel integration does not exist");
  const { token, teamId } = org.connections.vercel;

  const projects = await getGbRelatedVercelProjects(token, teamId);
  if (!projects || projects.length < 1)
    throw new Error("No project Id's found");

  const newEnvMap = reduceGbVercelEnvMap(gbVercelEnvMap);
  const orgGbKeys = await createOrgGbKeys(org.id, newEnvMap);

  //Create keys in Vercel for all GB related projects
  for (const project of projects) {
    for (const orgGbKey of orgGbKeys) {
      const payload: CreateEnvParams = {
        token,
        projectId: project.id,
        key: orgGbKey.key,
        target: orgGbKey.vercelEnvArr,
        type: "plain",
        value: orgGbKey.value,
        teamId,
      };
      await postEnvVar(payload);
    }
  }

  return res.status(200).json({ status: 200 });
}

export async function getConfig(req: AuthRequest, res: Response) {
  req.checkPermissions("organizationSettings");
  const { org } = getOrgFromReq(req);
  const liveGbKeys = await getAllApiKeysByOrganization(req.context);

  if (!org.connections?.vercel)
    throw new Error("Vercel integration does not exist");
  const { token, teamId } = org.connections.vercel;

  const projects = await getGbRelatedVercelProjects(token, teamId);
  if (!projects || projects.length < 1)
    throw new Error("No project Id's found");

  //iterates through vercel projects and gets env vars for each project and compares to gb keys to make a list of relevant keys
  const apiKeyRowList: ApiKeyRow[] = [];
  for (const project of projects) {
    const vercelEnvVars: VercelEnvVar[] = await getEnvVars(
      token,
      project.id,
      teamId
    );
    vercelEnvVars.forEach((vercelEnvVar) => {
      //gb API keys don't have a 'value' prop, so the gb key 'key' prop is used to compared to the vercel key 'value' prop
      const gbKey = liveGbKeys.find(
        (liveGbKey) => liveGbKey.key === vercelEnvVar.value
      );
      if (gbKey) {
        apiKeyRowList.push({
          projectId: project.id,
          projectName: project.name,
          key: vercelEnvVar.key,
          value: vercelEnvVar.value,
          gbEnvironment: gbKey.environment || "",
          target: vercelEnvVar.target,
          description: gbKey.description || "",
        });
      }
    });
  }

  return res.status(200).json({ status: 200, apiKeyRowList });
}
