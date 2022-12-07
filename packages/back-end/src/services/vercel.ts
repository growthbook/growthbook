import fetch from "node-fetch";
import {
  CreateEnvParams,
  VercelEnvVar,
  VercelProject,
  VercelTarget,
} from "../../types/vercel";
import { createApiKey } from "../models/ApiKeyModel";
import { logger } from "../util/logger";
import {
  APP_ORIGIN,
  VERCEL_CLIENT_ID,
  VERCEL_CLIENT_SECRET,
} from "../util/secrets";

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

  const json:
    | T
    | { error: { message: string; code: string } } = await res.json();
  if ("error" in json) {
    logger.error(json.error);
    throw new Error(json.error.message);
  }
  return json;
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
      encryptSDK: false,
      description:
        "This key is used by Vercel that allows you to connect your GrowthBook SDK to the GrowthBook API.",
    });
    orgGbKeys.push({
      key: "GROWTHBOOK_KEY",
      value: createdKeyVal.key,
      gbEnv: envMapEntry.gb,
      vercelEnvArr: envMapEntry.vercel,
      gbApiId: createdKeyVal.id,
    });
  }
  return orgGbKeys;
}

export async function getVercelToken(code: string): Promise<string> {
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
  if (json.error) {
    if (json.error?.message) {
      throw new Error(json.error.message);
    }
    throw new Error(json.error);
  }

  const token = json.access_token;

  return token;
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
