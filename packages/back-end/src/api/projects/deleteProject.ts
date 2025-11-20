import { DeleteProjectResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteProjectValidator } from "back-end/src/validators/openapi";
import { auditDetailsDelete } from "back-end/src/services/audit";
import { refreshSDKPayloadCache } from "back-end/src/services/features";
import { getPayloadKeysForAllEnvs } from "back-end/src/models/ExperimentModel";
import { logger } from "back-end/src/util/logger";

export const deleteProject = createApiRequestHandler(deleteProjectValidator)(
  async (req): Promise<DeleteProjectResponse> => {
    const project = await req.context.models.projects.deleteById(req.params.id);

    if (!project) throw new Error("Could not find project!");

    await req.audit({
      event: "project.delete",
      entity: {
        object: "project",
        id: project.id,
      },
      details: auditDetailsDelete(project),
    });

    return {
      deletedId: project.id,
    };
  },
);
