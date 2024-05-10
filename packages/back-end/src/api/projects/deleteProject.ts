import { DeleteProjectResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { deleteProjectValidator } from "../../validators/openapi";

export const deleteProject = createApiRequestHandler(deleteProjectValidator)(
  async (req): Promise<DeleteProjectResponse> => {
    let id = req.params.id;
    // Add `prj__` prefix if it doesn't exist
    if (!id.startsWith("prj__")) {
      id = `prj__${id}`;
    }

    await req.context.models.projects.deleteById(id);

    return {
      deletedId: id,
    };
  }
);
