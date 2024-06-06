import { PostProjectResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postProjectValidator } from "../../validators/openapi";
import { auditDetailsCreate } from "../../services/audit";
import { ProjectModel } from "../../models/ProjectModel";

export const postProject = createApiRequestHandler(postProjectValidator)(
  async (req): Promise<PostProjectResponse> => {
    const payload = ProjectModel.createValidator.parse(req.body);
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
