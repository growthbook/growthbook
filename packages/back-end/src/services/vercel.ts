import fetch from "node-fetch";
import { VercelEnvVar, VercelProject } from "../../types/vercel";

const vercelApiBaseUrl = "https://api.vercel.com";

const postToken = `${vercelApiBaseUrl}/v2/oauth/access_token`;
const getAllProjects = `${vercelApiBaseUrl}/v9/projects`;
const postOrGetEnvVarByProjectId = (projectId: string) =>
  `${vercelApiBaseUrl}/v9/projects/${projectId}/env`;

export const getQueryParams = (teamId: string | null) =>
  teamId ? `?${new URLSearchParams({ teamId })}` : "";

export const vercelApi = {
  postToken,
  getAllProjects,
  postOrGetEnvVarByProjectId,
};

const gbApiKey = {
  key: "GROWTHBOOK_KEY",
  description:
    "This key allows you to connect your GrowthBook sdk to the GrowthBook API.",
  value: "",
};

const gbWebhookKey = {
  key: "GROWTHBOOK_WEBHOOK_SECRET",
  description: "This key allows you to connect to GrowthBook webhooks.",
  value: "",
};

export const gbKeys = [gbApiKey, gbWebhookKey];

export async function getGbRelatedVercelProjects(
  token: string,
  configurationId: string,
  teamId: string | null
): Promise<VercelProject[]> {
  const url = vercelApi.getAllProjects + getQueryParams(teamId);
  const options = {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  };

  const res = await fetch(url, options);
  const json = await res.json();
  if (json.error) throw new Error(json.error);

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
  target: string,
  type: string,
  value: string,
  teamId: string | null
): Promise<void> {
  const url =
    vercelApi.postOrGetEnvVarByProjectId(projectId) + getQueryParams(teamId);
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      key: key,
      value: value,
      type: type,
      target: [target],
    }),
  };

  await fetch(url, options);
}

export async function getEnvVars(
  token: string,
  projectId: string,
  teamId: string | null
): Promise<VercelEnvVar[]> {
  const url =
    vercelApi.postOrGetEnvVarByProjectId(projectId) + getQueryParams(teamId);
  const options = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  const res = await fetch(url, options);
  const json = await res.json();
  if (json.error) throw new Error(json.error);

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
