import { projectListIntersection } from "shared/util";
import { PostEnvironmentResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { OrganizationInterface } from "back-end/types/organization";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { postForkEnvironmentValidator } from "back-end/src/validators/openapi";
import {
  getAllFeaturesWithRulesForEnvironment,
  syncEnvironmentSettings,
} from "back-end/src/models/FeatureModel";
import { promiseAllChunks } from "back-end/src/util/promise";
import { validatePayload } from "./validations";

export const postForkEnvironment = createApiRequestHandler(
  postForkEnvironmentValidator
)(
  async (req): Promise<PostEnvironmentResponse> => {
    const environment = await validatePayload(req.context, req.body);
    const { forkBase } = req.body;
    const org = req.context.org;

    if (org.settings?.environments?.some((env) => env.id === environment.id)) {
      throw Error(`Environment ${environment.id} already exists!`);
    }

    if (!req.context.permissions.canCreateEnvironment(environment))
      req.context.permissions.throwPermissionError();

    const baseEnvironment = org.settings?.environments?.find(
      (env) => env.id === forkBase
    );
    if (!baseEnvironment)
      throw new Error(`Cannot find environment ${forkBase}`);

    const updates: Partial<OrganizationInterface> = {
      settings: {
        ...org.settings,
        environments: [...(org.settings?.environments || []), environment],
      },
    };

    await updateOrganization(org.id, updates);

    const sharedProjects = projectListIntersection(
      baseEnvironment.projects || [],
      environment.projects || []
    );

    // We only need to copy feature rules if there are projects shared between both environments
    if (sharedProjects) {
      const features = await getAllFeaturesWithRulesForEnvironment(
        req.context,
        forkBase,
        sharedProjects
      );

      await promiseAllChunks(
        features.map((f) => () => {
          return syncEnvironmentSettings(
            req.context,
            f,
            forkBase,
            environment.id
          );
        }),
        10
      );
    }

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
