import fetch from "node-fetch";
import {
  CreateEnvParams,
  GbVercelEnvMap,
  VercelEnvVar,
  VercelProject,
  VercelTarget,
} from "../../types/vercel";
import { createApiKey } from "../models/ApiKeyModel";
import { logger } from "../util/logger";

interface VercelApiCallProps {
  token: string;
  teamId: string | null;
  endpoint: string;
  method: "POST" | "GET";
  body?: string;
}

async function vercelApiCall<T = unknown>({
  token,
  teamId,
  endpoint,
  method,
  body,
}: VercelApiCallProps): Promise<T> {
  if (teamId) {
    endpoint = endpoint + `?${new URLSearchParams({ teamId })}`;
  }
  const res = await fetch(`https://api.vercel.com${endpoint}`, {
    method,
    body,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const json: T | { error: string } = await res.json();
  if ("error" in json) {
    logger.error(json.error);
    throw new Error(json.error);
  }
  return json;
}

type ReducedMapping = { gb: string; vercel: VercelTarget[] };

//Takes env map entries that have the same GB environment and makes them into a single entry by joining the Vercel environments
export function reduceGbVercelEnvMap(gbVercelEnvMap: GbVercelEnvMap) {
  const newEnvMap: Record<string, ReducedMapping> = {};

  gbVercelEnvMap.forEach(({ gb, vercel }) => {
    if (!gb) return;
    newEnvMap[gb] = newEnvMap[gb] || { gb, vercel: [] };
    newEnvMap[gb].vercel.push(vercel);
  });

  return Object.values(newEnvMap);
}

export async function createOrgGbKeys(
  orgId: string,
  gbVercelEnvMap: { gb: string; vercel: VercelTarget[] }[]
) {
  const orgGbKeys = [];
  for (const envMapEntry of gbVercelEnvMap) {
    const createdKeyVal = await createApiKey({
      organization: orgId,
      secret: false,
      environment: envMapEntry.gb,
      project: "",
      encryptSDK: false,
      description:
        "This key is used by Vercel that allows you to connect your GrowthBook sdk to the GrowthBook API.",
    });
    orgGbKeys.push({
      key: "GROWTHBOOK_KEY",
      value: createdKeyVal.key,
      gbEnv: envMapEntry.gb,
      vercelEnvArr: envMapEntry.vercel,
    });
  }
  return orgGbKeys;
}

export async function getGbRelatedVercelProjects(
  token: string,
  teamId: string | null
): Promise<VercelProject[]> {
  const json = await vercelApiCall<{ projects: VercelProject[] }>({
    token,
    teamId,
    endpoint: `/v9/projects`,
    method: "GET",
  });
  return json.projects.filter((p) => !teamId || teamId === p.accountId);
}

export async function postEnvVar({
  token,
  projectId,
  key,
  target,
  type,
  value,
  teamId,
}: CreateEnvParams): Promise<void> {
  await vercelApiCall({
    token,
    teamId,
    endpoint: `/v9/projects/${projectId}/env`,
    method: "POST",
    body: JSON.stringify({
      key: key,
      value: value,
      type: type,
      target,
    }),
  });
}

export async function getEnvVars(
  token: string,
  projectId: string,
  teamId: string | null
): Promise<VercelEnvVar[]> {
  const json = await vercelApiCall<{ envs: VercelEnvVar[] }>({
    token,
    teamId,
    endpoint: `/v9/projects/${projectId}/env`,
    method: "GET",
  });
  return json.envs;
}
