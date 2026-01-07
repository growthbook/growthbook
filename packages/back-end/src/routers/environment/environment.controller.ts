import type { Response } from "express";
import { z } from "zod";
import { isEqual } from "lodash";
import { DEFAULT_ENVIRONMENT_IDS } from "shared/util";
import { EventUserForResponseLocals } from "shared/types/events/event-types";
import { Environment } from "shared/types/organization";
import {
  createEnvValidator,
  deleteEnvValidator,
  updateEnvOrderValidator,
  updateEnvValidator,
  updateEnvsValidator,
} from "shared/validators";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import { removeEnvironmentFromSlackIntegration } from "back-end/src/models/SlackIntegrationModel";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { PrivateApiErrorResponse } from "back-end/types/api";
import {
  getEnvironments,
  getContextFromReq,
} from "back-end/src/services/organizations";
import { addEnvironmentToOrganizationEnvironments } from "back-end/src/util/environments";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { refreshSDKPayloadCache } from "back-end/src/services/features";

type UpdateEnvOrderProps = z.infer<typeof updateEnvOrderValidator>;

type UpdateEnvironmentProps = z.infer<typeof updateEnvValidator>;

type CreateEnvironmentProps = z.infer<typeof createEnvValidator>;

type UpdateEnvironmentsProps = z.infer<typeof updateEnvsValidator>;

type DeleteEnvironmentProps = z.infer<typeof deleteEnvValidator>;

type CreateEnvironmentResponse = {
  environment: Environment;
};

export const putEnvironmentOrder = async (
  req: AuthRequest<UpdateEnvOrderProps>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { envId, newIndex } = req.body;
  const existingEnvs = org.settings?.environments;

  if (!existingEnvs) {
    return res.status(400).json({
      status: 400,
      message: "Unable to find organization's environments",
    });
  }

  // If the user doesn't have permission to update any envs, don't allow this action
  if (
    existingEnvs.some(
      (env) => !context.permissions.canUpdateEnvironment(env, {}),
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const envIndex = existingEnvs.findIndex((env) => env.id === envId);

  if (envIndex < 0) {
    return res.status(400).json({
      status: 400,
      message: `Unable to find environment: ${envId}`,
    });
  }

  const updatedEnvs = [...existingEnvs];

  if (newIndex < 0 || newIndex >= existingEnvs.length) {
    return res.status(400).json({
      status: 400,
      message: `Invalid new index: ${newIndex}`,
    });
  }
  updatedEnvs.splice(envIndex, 1);
  updatedEnvs.splice(newIndex, 0, existingEnvs[envIndex]);

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
  req: AuthRequest<UpdateEnvironmentsProps>,
  res: Response,
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
      false,
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
  req: AuthRequest<UpdateEnvironmentProps, { id: string }>,
  res: Response,
) => {
  const { environment } = req.body;
  const { id } = req.params;
  const context = getContextFromReq(req);
  const { org } = context;

  const envsArr = org.settings?.environments || [];

  const existingEnvIndex = envsArr.findIndex((env) => env.id === id);

  if (existingEnvIndex < 0) {
    return res.status(400).json({
      status: 400,
      message: `Could not find environment: ${id}`,
    });
  }

  if (
    !context.permissions.canUpdateEnvironment(
      envsArr[existingEnvIndex],
      environment,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const updatedEnvs = [...envsArr];
  updatedEnvs[existingEnvIndex] = { ...environment, id };

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
          (c) => c.environment === id,
        );

        await refreshSDKPayloadCache({
          context,
          payloadKeys: [],
          sdkConnections: affectedConnections,
        });
      }
    }

    await req.audit({
      event: "environment.update",
      entity: {
        object: "environment",
        id,
      },
      details: auditDetailsUpdate(envsArr[existingEnvIndex], {
        ...environment,
        id,
      }),
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
  req: AuthRequest<CreateEnvironmentProps>,
  res: Response<
    CreateEnvironmentResponse | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >,
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

  if (environment.parent && !DEFAULT_ENVIRONMENT_IDS.includes(environment.id)) {
    throw new Error(
      `Manual environment inheritance only valid for environments ${DEFAULT_ENVIRONMENT_IDS.join(
        ", ",
      )}. For programmatic control use the API endpoint instead.`,
    );
  }

  const updatedEnvironments = addEnvironmentToOrganizationEnvironments(
    context,
    environment,
    getEnvironments(org),
    false,
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
  req: AuthRequest<null, DeleteEnvironmentProps>,
  res: Response,
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
