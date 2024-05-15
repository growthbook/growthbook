import { PutEnvironmentResponse } from "../../../types/openapi";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "../../util/handler";
import { putEnvironmentValidator } from "../../validators/openapi";
import {
  findOrganizationById,
  updateOrganization,
} from "../../models/OrganizationModel";
import { OrganizationInterface } from "../../../types/organization";

export const putEnvironment = createApiRequestHandler(putEnvironmentValidator)(
  async (req): Promise<PutEnvironmentResponse> => {
    await validateIsSuperUserRequest(req);

    const id = req.params.id;
    const environmentId = req.params.environmentId;

    const org = await findOrganizationById(id);
    if (!org) {
      throw Error("Organization not found");
    }

    const environments = org.settings?.environments || [];

    const environment = environments.find((env) => env.id === environmentId);
    if (!environment) {
      throw Error(`Environment ${environmentId} does not exists!`);
    }

    const description = req.body.description || environment.description || "";
    const defaultState =
      req.body.description !== undefined
        ? !!req.body.defaultState
        : !!environment.defaultState;
    const toggleOnList =
      req.body.toggleOnList !== undefined
        ? !!req.body.toggleOnList
        : !!environment.toggleOnList;

    const updatedEnvironment = {
      id: environmentId,
      description,
      defaultState,
      toggleOnList,
    };

    const updates: Partial<OrganizationInterface> = {
      settings: {
        ...org.settings,
        environments: [
          ...environments.filter((env) => env.id !== environmentId),
          updatedEnvironment,
        ],
      },
    };

    await updateOrganization(id, updates);

    return {
      environment: updatedEnvironment,
    };
  }
);
