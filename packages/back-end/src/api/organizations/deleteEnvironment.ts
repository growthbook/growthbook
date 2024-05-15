import { DeleteEnvironmentResponse } from "../../../types/openapi";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "../../util/handler";
import { deleteEnvironmentValidator } from "../../validators/openapi";
import {
  findOrganizationById,
  updateOrganization,
} from "../../models/OrganizationModel";
import { OrganizationInterface } from "../../../types/organization";

export const deleteEnvironment = createApiRequestHandler(
  deleteEnvironmentValidator
)(
  async (req): Promise<DeleteEnvironmentResponse> => {
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

    const updates: Partial<OrganizationInterface> = {
      settings: {
        ...org.settings,
        environments: [
          ...environments.filter((env) => env.id !== environmentId),
        ],
      },
    };

    await updateOrganization(id, updates);

    return {
      deletedId: environmentId,
    };
  }
);
