import fetch from "node-fetch";
import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { updateOrganization } from "../models/OrganizationModel";
import { getOrgFromReq } from "../services/organizations";
import { createApiKey, getAllApiKeysByOrganization } from "../services/apiKey";
import { GbVercelKeyMap, ApiKeyRow, VercelEnvVar } from "../../types/vercel";
import {
  gbKeys,
  getEnvVars,
  getGbRelatedVercelProjects,
  postEnvVar,
  vercelApi,
} from "../services/vercel";

export async function postToken(req: AuthRequest, res: Response) {
  const { code, configurationId, teamId } = req.body;
  const { org } = getOrgFromReq(req);

  const url = vercelApi.postToken;
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code: code,
      client_id: process.env.VERCEL_CLIENT_ID as string,
      client_secret: process.env.VERCEL_CLIENT_SECRET as string,
      redirect_uri: "https://app.growthbook.io/integrations/vercel",
    }),
  };

  const tokenRes = await fetch(url, options);
  const json = await tokenRes.json();
  if (json.error) throw new Error(json.error);

  const updatePayload = { token: json.access_token, configurationId, teamId };
  await updateOrganization(org.id, { connections: { vercel: updatePayload } });
  return res.status(200).json({ status: 200 });
}

export async function postEnvVars(req: AuthRequest, res: Response) {
  try {
    const { gbVercelKeyMap }: { gbVercelKeyMap: GbVercelKeyMap } = req.body;
    const { org } = getOrgFromReq(req);

    if (!org.connections?.vercel)
      throw new Error("Vercel integration does not exist");
    const { token, configurationId, teamId } = org.connections.vercel;

    const projects = await getGbRelatedVercelProjects(
      token,
      configurationId,
      teamId
    );
    if (!projects || projects.length < 1)
      throw new Error("No project Id's found");

    for (const elem of gbVercelKeyMap) {
      //If dropdown for "Vercel Environment" is "None", we don't want to create an env var for that
      if (elem.vercel) {
        //Create keys in GrowthBook
        for (let i = 0; i < gbKeys.length; i++) {
          const createdKeyVal = await createApiKey(
            org.id,
            elem.gb,
            gbKeys[i].description
          );
          gbKeys[i].value = createdKeyVal;
        }

        //Create keys in Vercel for all relavent projects
        for (const project of projects) {
          for (const gbKey of gbKeys) {
            await postEnvVar(
              token,
              project.id,
              gbKey.key,
              elem.vercel as string,
              "plain",
              gbKey.value,
              teamId
            );
          }
        }
      }
    }

    return res.status(200).json({ status: 200 });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ status: 400 });
  }
}

export async function getConfig(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const gbKeys = await getAllApiKeysByOrganization(org.id);

  if (!org.connections?.vercel)
    throw new Error("Vercel integration does not exist");
  const { token, configurationId, teamId } = org.connections.vercel;

  const projects = await getGbRelatedVercelProjects(
    token,
    configurationId,
    teamId
  );
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
      const gbKey = gbKeys.find((gbKey) => gbKey.key === vercelEnvVar.value);
      if (gbKey) {
        apiKeyRowList.push({
          projectId: project.id,
          projectName: project.name,
          key: vercelEnvVar.key,
          value: vercelEnvVar.value,
          gbEnvironment: gbKey.environment as string,
          vercelEnvironment: vercelEnvVar.target[0] as string,
          description: gbKey.description as string,
        });
      }
    });
  }

  return res.status(200).json({ status: 200, apiKeyRowList });
}
