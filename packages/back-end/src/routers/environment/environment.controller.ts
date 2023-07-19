import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { PrivateApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { EventAuditUserForResponseLocals } from "../../events/event-types";
import { Environment } from "../../../types/organization";
import {
  addEnvironmentToOrganizationEnvironments,
  containsEnvironment,
} from "../../util/environments";
import { updateOrganization } from "../../models/OrganizationModel";

// region POST /environment

type CreateEnvironmentRequest = AuthRequest<{
  environment: Environment;
}>;

type CreateEnvironmentResponse = {
  environment: Environment;
};

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

  const { org } = getOrgFromReq(req);

  const existingEnvironments = org.settings?.environments || [];

  if (containsEnvironment(existingEnvironments, environment)) {
    return res.status(400).json({
      status: 400,
      message: `Environment ${environment.id} already exists`,
    });
  }

  const updatedEnvironments = addEnvironmentToOrganizationEnvironments(
    environment,
    existingEnvironments,
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
