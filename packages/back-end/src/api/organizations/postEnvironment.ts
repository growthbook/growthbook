import { PostEnvironmentResponse } from "../../../types/openapi";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "../../util/handler";
import { postEnvironmentValidator } from "../../validators/openapi";
import {
  findOrganizationById,
  updateOrganization,
} from "../../models/OrganizationModel";
import { OrganizationInterface } from "../../../types/organization";

export const postEnvironment = createApiRequestHandler(
  postEnvironmentValidator
)(
  async (req): Promise<PostEnvironmentResponse> => {
    await validateIsSuperUserRequest(req);

    const id = req.params.id;
    const { id: envId, description, toggleOnList, defaultState } = req.body;

    if (envId === "") throw Error("Environment ID cannot empty!");

    const environment = {
      id: envId,
      description,
      toggleOnList: !!toggleOnList,
      defaultState: !!defaultState,
    };

    const org = await findOrganizationById(id);
    if (!org) {
      throw Error("Organization not found");
    }

    if (org.settings?.environments?.some((env) => env.id === envId)) {
      throw Error(`Environment ${envId} already exists!`);
    }

    const updates: Partial<OrganizationInterface> = {
      settings: {
        ...org.settings,
        environments: [...(org.settings?.environments || []), environment],
      },
    };

    await updateOrganization(id, updates);

    return {
      environment,
    };
  }
);
