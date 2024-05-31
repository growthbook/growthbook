import type { Response } from "express";
import { isEqual } from "lodash";
import { findSDKConnectionsByOrganization } from "../../models/SdkConnectionModel";
import { triggerSingleSDKWebhookJobs } from "../../jobs/updateAllJobs";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../../services/audit";
import { removeEnvironmentFromSlackIntegration } from "../../models/SlackIntegrationModel";
import { AuthRequest } from "../../types/AuthRequest";
import { PrivateApiErrorResponse } from "../../../types/api";
import {
  getEnvironments,
  getContextFromReq,
} from "../../services/organizations";
import { EventAuditUserForResponseLocals } from "../../events/event-types";
import { Environment } from "../../../types/organization";
import { addEnvironmentToOrganizationEnvironments } from "../../util/environments";
import { updateOrganization } from "../../models/OrganizationModel";

type CreateEnvironmentRequest = AuthRequest<{
  environment: Environment;
}>;

type CreateEnvironmentResponse = {
  environment: Environment;
};

export const putEnvironmentOrder = async (
  req: AuthRequest<{
    environments: string[];
  }>,
  res: Response
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const envIds = req.body.environments;

  const existingEnvs = org.settings?.environments;

  if (!existingEnvs) {
    return res.status(400).json({
      status: 400,
      message: "Unable to find organization's environments",
    });
  }

  // If the user doesn't have permission to update any envs, don't allow this action
  if (
    existingEnvs.every(
      (env) => !context.permissions.canUpdateEnvironment(env, {})
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const updatedEnvs: Environment[] = [];

  // Loop through env ids, to get the full env object and add it to the updatedEnvs arr
  envIds.forEach((envId) => {
    const env = existingEnvs.find((existing) => existing.id === envId);

    if (!env) {
      return res.status(400).json({
        status: 400,
        message: `Unable to find environment: ${envId}`,
      });
    }

    updatedEnvs.push(env);
  });

  try {
    await updateOrganization(org.id, {
      settings: {
        ...org.settings,
        environments: updatedEnvs,
      },
    });

    await req.audit({
      event: "environment.update",
      entity: {
        object: "organization",
        id: org.id,
      },
      details: auditDetailsUpdate(existingEnvs, updatedEnvs),
    });

    res.json({ environments: updatedEnvs });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
};

export const putEnvironments = async (
  req: AuthRequest<{
    environments: Environment[];
  }>,
  res: Response
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const environments = req.body.environments;
  const existingEnvs = org.settings?.environments || [];

  // Add each environment to the list if it doesn't exist yet
  const updatedEnvironments = environments.reduce((acc, environment) => {
    return addEnvironmentToOrganizationEnvironments(
      context,
      environment,
      acc,
      false
    );
  }, getEnvironments(org));

  try {
    await updateOrganization(org.id, {
      settings: {
        ...org.settings,
        environments: updatedEnvironments,
      },
    });

    await req.audit({
      event: "environment.update",
      entity: {
        object: "organization",
        id: org.id,
      },
      details: auditDetailsUpdate(existingEnvs, updatedEnvironments),
    });

    res.json({ environments, status: 200 });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
};

export const putEnvironment = async (
  req: AuthRequest<
    {
      environment: Environment;
    },
    { id: string }
  >,
  res: Response
) => {
  const { environment } = req.body;
  const context = getContextFromReq(req);
  const { org } = context;

  const envsArr = org.settings?.environments || [];

  const existingEnvIndex = envsArr.findIndex(
    (env) => env.id === environment.id
  );

  if (existingEnvIndex < 0) {
    return res.status(400).json({
      status: 400,
      message: `Could not find environment: ${environment.id}`,
    });
  }

  if (
    !context.permissions.canUpdateEnvironment(
      envsArr[existingEnvIndex],
      environment
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const updatedEnvs = [...envsArr];
  updatedEnvs[existingEnvIndex] = environment;

  try {
    await updateOrganization(org.id, {
      settings: {
        ...org.settings,
        environments: updatedEnvs,
      },
    });

    if (environment.projects) {
      const existingProjects = envsArr[existingEnvIndex].projects || [];
      const newProjects = environment.projects;

      if (!isEqual(existingProjects, newProjects)) {
        const connections = await findSDKConnectionsByOrganization(context);
        const affectedConnections = connections.filter(
          (c) => c.environment === environment.id
        );

        for (const connection of affectedConnections) {
          const isUsingProxy = !!(
            connection.proxy.enabled && connection.proxy.host
          );
          await triggerSingleSDKWebhookJobs(
            context,
            connection,
            {},
            connection.proxy,
            isUsingProxy
          );
        }
      }
    }

    await req.audit({
      event: "environment.update",
      entity: {
        object: "environment",
        id: environment.id,
      },
      details: auditDetailsUpdate(envsArr[existingEnvIndex], environment),
    });

    res.status(200).json({
      status: 200,
      environment,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
};

// region POST /environment

/**
 * POST /environment
 * Create a environment resource
 * @param req
 * @param res
 */
export const postEnvironment = async (
  req: CreateEnvironmentRequest,
  res: Response<
    CreateEnvironmentResponse | PrivateApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  const { environment } = req.body;

  const context = getContextFromReq(req);
  const { org, environments } = context;

  if (environments.includes(environment.id)) {
    return res.status(400).json({
      status: 400,
      message: `Environment ${environment.id} already exists`,
    });
  }

  const updatedEnvironments = addEnvironmentToOrganizationEnvironments(
    context,
    environment,
    getEnvironments(org),
    false
  );

  try {
    await updateOrganization(org.id, {
      settings: {
        ...org.settings,
        environments: updatedEnvironments,
      },
    });

    await req.audit({
      event: "environment.create",
      entity: {
        object: "environment",
        id: environment.id,
      },
      details: auditDetailsCreate(environment),
    });

    res.status(200).json({
      status: 200,
      environment,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
};

// endregion POST /environment

export const deleteEnvironment = async (
  req: AuthRequest<null, { id: string }>,
  res: Response
) => {
  const id = req.params.id;
  const context = getContextFromReq(req);
  const { org } = context;

  const existingEnvs = org.settings?.environments || [];

  const envToDelete = existingEnvs.find((existing) => existing.id === id);

  if (!envToDelete) {
    return res.status(400).json({
      status: 400,
      message: `Unable to find environment: ${id}`,
    });
  }

  if (!context.permissions.canDeleteEnvironment(envToDelete)) {
    context.permissions.throwPermissionError();
  }

  try {
    await updateOrganization(org.id, {
      settings: {
        ...org.settings,
        environments: existingEnvs.filter((env) => env.id !== id),
      },
    });

    await req.audit({
      event: "environment.delete",
      entity: {
        object: "environment",
        id,
      },
      details: auditDetailsDelete(id),
    });

    removeEnvironmentFromSlackIntegration({
      organizationId: org.id,
      envId: id,
    });

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
};
