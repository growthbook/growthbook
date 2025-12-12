import { PutEnvironmentResponse } from "shared/types/openapi";
import { putEnvironmentValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { OrganizationInterface } from "back-end/types/organization";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { validatePayload } from "./validations";

export const putEnvironment = createApiRequestHandler(putEnvironmentValidator)(
  async (req): Promise<PutEnvironmentResponse> => {
    const id = req.params.id;
    const org = req.context.org;
    const environments = org.settings?.environments || [];

    const environment = environments.find((env) => env.id === id);
    if (!environment) {
      throw Error(`Environment ${id} does not exists!`);
    }

    const updatedEnvironment = await validatePayload(req.context, {
      ...environment,
      ...req.body,
    });

    if (
      !req.context.permissions.canUpdateEnvironment(
        environment,
        updatedEnvironment,
      )
    )
      req.context.permissions.throwPermissionError();

    const updates: Partial<OrganizationInterface> = {
      settings: {
        ...org.settings,
        environments: environments.map((env) =>
          env.id === id ? updatedEnvironment : env,
        ),
      },
    };

    await updateOrganization(org.id, updates);

    await req.audit({
      event: "environment.update",
      entity: {
        object: "environment",
        id: environment.id,
      },
      details: auditDetailsUpdate(environment, updatedEnvironment),
    });

    return {
      environment: updatedEnvironment,
    };
  },
);
