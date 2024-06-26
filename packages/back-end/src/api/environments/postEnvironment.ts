import { PostEnvironmentResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postEnvironmentValidator } from "../../validators/openapi";
import { updateOrganization } from "../../models/OrganizationModel";
import { OrganizationInterface } from "../../../types/organization";
import { auditDetailsCreate } from "../../services/audit";
import { validatePayload } from "./validations";

export const postEnvironment = createApiRequestHandler(
  postEnvironmentValidator
)(
  async (req): Promise<PostEnvironmentResponse> => {
    const environment = await validatePayload(req.context, req.body);

    const org = req.context.org;

    if (org.settings?.environments?.some((env) => env.id === environment.id)) {
      throw Error(`Environment ${environment.id} already exists!`);
    }

    if (!req.context.permissions.canCreateEnvironment(environment))
      req.context.permissions.throwPermissionError();

    const updates: Partial<OrganizationInterface> = {
      settings: {
        ...org.settings,
        environments: [...(org.settings?.environments || []), environment],
      },
    };

    await updateOrganization(org.id, updates);

    await req.audit({
      event: "environment.create",
      entity: {
        object: "environment",
        id: environment.id,
      },
      details: auditDetailsCreate(environment),
    });

    return {
      environment,
    };
  }
);
