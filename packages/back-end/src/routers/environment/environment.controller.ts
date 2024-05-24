import type { Response } from "express";
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

  const updatedEnvs: Environment[] = [];

  // Loop through env ids, to get the full env object and add it to the updatedEnvs arr
  envIds.forEach((environment) => {
    const index = existingEnvs.findIndex((env) => env.id === environment);

    if (index < 0) {
      return res.status(400).json({
        status: 400,
        message: `Unable to find environment: ${environment}`,
      });
    }

    updatedEnvs.push(existingEnvs[index]);
  });

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      environments: updatedEnvs,
    },
  });
  res.json({ environments: updatedEnvs });
};

export const putEnvironments = async (
  req: AuthRequest<{
    environments: Environment[];
  }>,
  res: Response<{
    environments: Environment[];
  }>
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const environments = req.body.environments;

  //MKTODO: When I break this out, I need to check if it exists, if so, check update, otherwise check canCreate logic
  environments.forEach((environment) => {
    if (!context.permissions.canCreateOrUpdateEnvironment(environment)) {
      context.permissions.throwPermissionError();
    }
  });

  // Add each environment to the list if it doesn't exist yet
  const updatedEnvironments = environments.reduce((acc, environment) => {
    return addEnvironmentToOrganizationEnvironments(environment, acc, false);
  }, getEnvironments(org));

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      environments: updatedEnvironments,
    },
  });

  //MKTODO: Do I need to trigger any webhooks?
  res.json({ environments });
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

  const envsArr = org.settings?.environments;

  if (!envsArr) {
    return res.status(400).json({
      status: 400,
      message: "Unable to find organization's environments",
    });
  }

  const existingEnvIndex = envsArr.findIndex(
    (env) => env.id === environment.id
  );

  if (!existingEnvIndex || existingEnvIndex < 0) {
    return res.status(400).json({
      status: 400,
      message: `Could not find environment: ${environment.id}`,
    });
  }

  //MKTODO: Update this to canUpdate when I break canCreateOrUpdateEnvironment out into two methods
  if (!context.permissions.canCreateOrUpdateEnvironment(environment)) {
    context.permissions.throwPermissionError();
  }

  envsArr[existingEnvIndex] = environment;

  try {
    await updateOrganization(org.id, {
      settings: {
        ...org.settings,
        environments: envsArr,
      },
    });

    //MKTODO: Do I need to trigger any webhooks?

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

  //MKTODO: Update this to canCreateEnvironment
  if (!context.permissions.canCreateOrUpdateEnvironment(environment)) {
    context.permissions.throwPermissionError();
  }

  if (environments.includes(environment.id)) {
    return res.status(400).json({
      status: 400,
      message: `Environment ${environment.id} already exists`,
    });
  }

  const updatedEnvironments = addEnvironmentToOrganizationEnvironments(
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

  const envsArr = org.settings?.environments;

  if (!envsArr) {
    return res.status(400).json({
      status: 400,
      message: `Could not find environment: ${id}`,
    });
  }

  const existingEnvIndex = envsArr.findIndex((env) => env.id === id);

  if (!existingEnvIndex || existingEnvIndex < 0) {
    return res.status(400).json({
      status: 400,
      message: `Could not find environment: ${id}`,
    });
  }

  if (!context.permissions.canDeleteEnvironment(envsArr[existingEnvIndex])) {
    context.permissions.throwPermissionError();
  }

  try {
    await updateOrganization(org.id, {
      settings: {
        ...org.settings,
        environments: envsArr.filter((env) => env.id !== id),
      },
    });

    //MKTODO: Do I need to trigger any webhooks?

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
