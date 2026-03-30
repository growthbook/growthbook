import { DeleteProjectResponse } from "shared/types/openapi";
import { deleteProjectValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteProject = createApiRequestHandler(deleteProjectValidator)(
  async (req): Promise<DeleteProjectResponse> => {
    const project = await req.context.models.projects.deleteById(req.params.id);

    if (!project) throw new Error("Could not find project!");

    return {
      deletedId: project.id,
    };
  },
);
