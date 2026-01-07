import { PutEnvironmentResponse } from "shared/types/openapi";
import { putEnvironmentValidator } from "shared/validators";
import { OrganizationInterface } from "shared/types/organization";
import { isEqual } from "lodash";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import { refreshSDKPayloadCache } from "back-end/src/services/features";
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

    if (environment.projects) {
      const existingProjects = environment.projects;
      const newProjects = updatedEnvironment.projects;

      if (!isEqual(existingProjects, newProjects)) {
        const connections = await findSDKConnectionsByOrganization(req.context);
        const affectedConnections = connections.filter(
          (c) => c.environment === id,
        );

        await refreshSDKPayloadCache({
          context: req.context,
          payloadKeys: [],
          sdkConnections: affectedConnections,
        });
      }
    }

    return {
      environment: updatedEnvironment,
    };
  },
);
