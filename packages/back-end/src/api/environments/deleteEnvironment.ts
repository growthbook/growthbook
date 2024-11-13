import { DeleteEnvironmentResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteEnvironmentValidator } from "back-end/src/validators/openapi";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { OrganizationInterface } from "back-end/types/organization";
import { auditDetailsDelete } from "back-end/src/services/audit";
import { removeEnvironmentFromFeatureRules } from "back-end/src/models/FeatureModel";

export const deleteEnvironment = createApiRequestHandler(
  deleteEnvironmentValidator
)(
  async (req): Promise<DeleteEnvironmentResponse> => {
    const id = req.params.id;
    const org = req.context.org;
    const environments = org.settings?.environments || [];
    const { removeAssociatedFeatureRules } = req.body;

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

    if (removeAssociatedFeatureRules) {
      // Asynchronously removes all feature rules that would be orphaned by deleting this environment
      removeEnvironmentFromFeatureRules(req.context, id);
    }

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
