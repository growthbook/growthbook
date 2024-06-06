import { DeleteProjectResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { deleteProjectValidator } from "../../validators/openapi";
import { auditDetailsDelete } from "../../services/audit";

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
  }
);
