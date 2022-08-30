import fetch from "node-fetch";
import {
  GbVercelEnvMap,
  PostEnvVarBody,
  VercelEnvVar,
  VercelProject,
  VercelTarget,
} from "../../types/vercel";
import { createApiKey } from "./apiKey";

const vercelApiBaseUrl = "https://api.vercel.com";

const postOrGetEnvVarByProjectId = (projectId: string) =>
  `${vercelApiBaseUrl}/v9/projects/${projectId}/env`;

const getQueryParams = (teamId: string | null) =>
  teamId ? `?${new URLSearchParams({ teamId })}` : "";

const gbApiKey = {
  key: "GROWTHBOOK_KEY",
  description:
    "This key allows you to connect your GrowthBook sdk to the GrowthBook API.",
};
const gbWebhookKey = {
  key: "GROWTHBOOK_WEBHOOK_SECRET",
  description: "This key allows you to connect to GrowthBook webhooks.",
};
const gbKeys = [gbApiKey, gbWebhookKey];

interface VercelApiCallProps {
  token: string;
  teamId: string | null;
  url: string;
  method: "POST" | "GET";
  body?: PostEnvVarBody;
  hasResult: boolean;
}

async function vercelApiCall({
  token,
  teamId,
  url,
  method,
  body,
  hasResult,
}: VercelApiCallProps) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
  // eslint-disable-next-line
  // @ts-ignore
  if (body) options.body = body;
  url = url + getQueryParams(teamId);

  const res = await fetch(url, options);
  if (!hasResult) return;

  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

//Takes env map entries that have the same GB environment and makes them into a single entry by joining the Vercel environments
export function reduceGbVercelEnvMap(gbVercelEnvMap: GbVercelEnvMap) {
  const newEnvMap: { gb: string; vercel: VercelTarget[] }[] = [];
  for (let i = 0; i < gbVercelEnvMap.length; i++) {
    const elem = gbVercelEnvMap[i];
    //If dropdown for "GrowthBook Environment" is "None", we don't want to create an env var
    if (!elem.gb) continue;

    let match = false;
    for (let j = 0; j < newEnvMap.length; j++) {
      if (elem.gb === newEnvMap[j].gb) {
        match = true;
        newEnvMap[j].vercel.push(elem.vercel);
        break;
      }
    }
    if (!match) newEnvMap.push({ gb: elem.gb, vercel: [elem.vercel] });
  }
  return newEnvMap;
}

export async function createOrgGbKeys(
  orgId: string,
  gbVercelEnvMap: { gb: string; vercel: VercelTarget[] }[]
) {
  const orgGbKeys = [];
  for (const envMapEntry of gbVercelEnvMap) {
    for (const gbKey of gbKeys) {
      const createdKeyVal = await createApiKey(
        orgId,
        envMapEntry.gb,
        gbKey.description
      );
      orgGbKeys.push({
        key: gbKey.key,
        value: createdKeyVal,
        gbEnv: envMapEntry.gb,
        vercelEnvArr: envMapEntry.vercel,
      });
    }
  }
  return orgGbKeys;
}

export async function getGbRelatedVercelProjects(
  token: string,
  teamId: string | null
): Promise<VercelProject[]> {
  const json = await vercelApiCall({
    token,
    teamId,
    url: `${vercelApiBaseUrl}/v9/projects`,
    method: "GET",
    hasResult: true,
  });

  const relatedProjects: VercelProject[] = [];
  json.projects.forEach((project: VercelProject) => {
    if (!teamId || (teamId && project.accountId === teamId)) {
      relatedProjects.push({
        id: project.id,
        name: project.name,
      });
    }
  });
  return relatedProjects;
}

export async function postEnvVar(
  token: string,
  projectId: string,
  key: string,
  targetArr: VercelTarget[],
  type: string,
  value: string,
  teamId: string | null
): Promise<void> {
  await vercelApiCall({
    token,
    teamId,
    url: postOrGetEnvVarByProjectId(projectId),
    method: "POST",
    body: JSON.stringify({
      key: key,
      value: value,
      type: type,
      target: targetArr,
    }),
    hasResult: false,
  });
}

export async function getEnvVars(
  token: string,
  projectId: string,
  teamId: string | null
): Promise<VercelEnvVar[]> {
  const json = await vercelApiCall({
    token,
    teamId,
    url: postOrGetEnvVarByProjectId(projectId),
    method: "GET",
    hasResult: true,
  });

  const vercelEnvVars: VercelEnvVar[] = [];
  json.envs.forEach((env: VercelEnvVar) => {
    vercelEnvVars.push({
      key: env.key,
      value: env.value,
      target: env.target,
    });
  });
  return vercelEnvVars;
}
