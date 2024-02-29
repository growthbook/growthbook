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

export const putEnvironments = async (
  req: AuthRequest<{
    environments: Environment[];
  }>,
  res: Response<{
    environments: Environment[];
  }>
) => {
  const { org } = getContextFromReq(req);
  const environments = req.body.environments;

  req.checkPermissions(
    "manageEnvironments",
    "",
    environments.map((e) => e.id)
  );

  // Add each environment to the list if it doesn't exist yet
  const updatedEnvironments = environments.reduce((acc, environment) => {
    return addEnvironmentToOrganizationEnvironments(environment, acc, false);
  }, getEnvironments(org));

  await updateOrganization(org.id, {
    settings: {
      environments: updatedEnvironments,
    },
  });
  res.json({ environments });
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
  // TODO: Migrate this endpoint to use the new data modelling - https://github.com/growthbook/growthbook/issues/1391
  const { environment } = req.body;

  req.checkPermissions("manageEnvironments", "", [environment.id]);

  const { org, environments } = getContextFromReq(req);

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
