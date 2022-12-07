import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { updateOrganization } from "../models/OrganizationModel";
import { getOrgFromReq } from "../services/organizations";
import {
  GbVercelEnvMap,
  CreateEnvParams,
  VercelTarget,
} from "../../types/vercel";
import {
  createOrgGbKeys,
  getGbRelatedVercelProjects,
  postEnvVar,
  getVercelToken,
} from "../services/vercel";
import { auditDetailsUpdate } from "../services/audit";
import {
  OrganizationInterface,
  VercelConnection,
} from "../../types/organization";

// export async function getHasToken(req: AuthRequest, res: Response) {
//   const { org } = await getOrgFromReq(req);
//   res.status(200).json({ hasToken: !!org.connections?.vercel?.token });
// }

export async function getVercelIntegrations(req: AuthRequest, res: Response) {
  const { org } = await getOrgFromReq(req);
  const { vercel } = org.connections || {};
  //console.log(org);
  // const vercelIntegrations: VercelConnection[] = [];
  // vercel?.map((vc) => {
  //   vercelIntegrations.push(vc);
  // });
  //
  // const vercelProjects = await getGbRelatedVercelProjects(org, token, teamId);
  // const gbVercelEnvMap = await getEnvVars(org, vercelProjects, token, teamId);
  // const reducedGbVercelEnvMap = reduceGbVercelEnvMap(gbVercelEnvMap);
  //console.log("here, vercel", vercel);
  res.status(200).json({ vercel });
}

export async function postAddIntegration(
  req: AuthRequest<{
    code: string;
    configurationId: string;
    teamId: string;
    envs: GbVercelEnvMap;
  }>,
  res: Response
) {
  req.checkPermissions("organizationSettings");
  const { code, configurationId, teamId, envs } = req.body;
  const { org } = getOrgFromReq(req);

  // step one: get the existing integrations and make sure this one isn't already added
  if (org.connections?.vercel) {
    org.connections.vercel.forEach((vercel) => {
      if (vercel.configurationId === configurationId) {
        throw new Error(
          "This Vercel integration is already added to your organization."
        );
      }
    });
  }

  // step two: validate and get the token
  const token = await getVercelToken(code);
  if (!token) {
    throw new Error("Unable to get Vercel token.");
  }

  // got the token, now get the user's projects on Vercel
  const projects = await getGbRelatedVercelProjects(token, teamId);
  if (!projects || projects.length < 1)
    throw new Error("No Vercel project Id's found");

  // create any environments that are needed in GrowthBook:
  const envMap = new Map();
  org.settings?.environments?.forEach((env) => {
    envMap.set(env.id, env);
  });
  const newEnvMap: Map<
    string,
    { gb: string; vercel: VercelTarget[] }
  > = new Map();

  envs.map(async ({ gb, vercel }, i) => {
    const vercelName = vercel[0];
    if (gb === "-none-") {
      // skip this one
      return;
    } else if (gb === "") {
      // auto create this environment
      const updates: Partial<OrganizationInterface> = {};
      const orig: Partial<OrganizationInterface> = {};
      orig.settings = org.settings;
      updates.settings = {
        ...org.settings,
      };
      if (!updates.settings?.environments) {
        updates.settings.environments = [];
      }
      if (envMap.has(vercelName)) {
        // Edge case, but this environment already exists, so we will use it
        envs[i].gb = envMap.get(vercelName).id;
        return;
      }
      // we need to create a new environment in GrowthBook
      try {
        updates.settings.environments.push({
          id: vercelName,
          description: "Vercel environment",
        });
        await updateOrganization(org.id, updates);

        await req.audit({
          event: "organization.update",
          entity: {
            object: "organization",
            id: org.id,
          },
          details: auditDetailsUpdate(orig, updates, {
            context: "Environment create by Vercel integration",
            environment: vercelName,
          }),
        });
      } catch (e) {
        throw new Error(`Error creating environment ${gb}: ${e.message}`);
      }
    }
    // store the environment mapping
    if (gb) {
      if (newEnvMap.has(gb)) {
        const existing = newEnvMap.get(gb)?.vercel || [];
        newEnvMap.set(gb, {
          gb,
          vercel: [...existing, vercelName],
        });
      } else {
        newEnvMap.set(gb, { gb, vercel: [vercelName] });
      }
    }
  });

  // step three: create the API keys
  const newEnvMapArr = Object.values(Object.fromEntries(newEnvMap));
  const orgGbKeys = await createOrgGbKeys(org.id, newEnvMapArr);

  // Create keys in Vercel for all GB related projects
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

  // step four: save the token and settings in org
  const orig = org.connections?.vercel;
  const updatePayload: VercelConnection = {
    token: token,
    configurationId,
    teamId,
    environments: newEnvMapArr,
    apiKeys: orgGbKeys.map((k) => {
      return k.gbApiId || "";
    }),
  };
  const connectionsUpdates: Partial<OrganizationInterface> = {};
  connectionsUpdates.connections = { ...org.connections };
  if (!connectionsUpdates.connections?.vercel) {
    connectionsUpdates.connections.vercel = [];
  }
  connectionsUpdates.connections.vercel.push(updatePayload);

  await updateOrganization(org.id, connectionsUpdates);

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
