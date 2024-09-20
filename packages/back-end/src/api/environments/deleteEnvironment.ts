import { DeleteEnvironmentResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { deleteEnvironmentValidator } from "../../validators/openapi";
import { updateOrganization } from "../../models/OrganizationModel";
import { OrganizationInterface } from "../../../types/organization";
import { auditDetailsDelete } from "../../services/audit";

export const deleteEnvironment = createApiRequestHandler(
  deleteEnvironmentValidator
)(
  async (req): Promise<DeleteEnvironmentResponse> => {
    const id = req.params.id;
    const org = req.context.org;
    const environments = org.settings?.environments || [];

    const environment = environments.find((env) => env.id === id);
    if (!environment) {
      throw Error(`Environment ${id} does not exists!`);
    }

    if (!req.context.permissions.canDeleteEnvironment(environment))
      req.context.permissions.throwPermissionError();

    const updates: Partial<OrganizationInterface> = {
      settings: {
        ...org.settings,
        environments: [...environments.filter((env) => env.id !== id)],
      },
    };

    await updateOrganization(org.id, updates);

    await req.audit({
      event: "environment.delete",
      entity: {
        object: "environment",
        id: environment.id,
      },
      details: auditDetailsDelete(environment),
    });

    return {
      deletedId: id,
    };
  }
);
