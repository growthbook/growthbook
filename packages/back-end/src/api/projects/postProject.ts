import { PostProjectResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postProjectValidator } from "back-end/src/validators/openapi";
import { auditDetailsCreate } from "back-end/src/services/audit";

export const postProject = createApiRequestHandler(postProjectValidator)(
  async (req): Promise<PostProjectResponse> => {
    const payload = req.context.models.projects.createValidator.parse(req.body);
    const project = await req.context.models.projects.create(payload);

    await req.audit({
      event: "project.create",
      entity: {
        object: "project",
        id: project.id,
      },
      details: auditDetailsCreate(project),
    });

    return {
      project: req.context.models.projects.toApiInterface(project),
    };
  }
);
