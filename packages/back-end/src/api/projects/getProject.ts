import { getProjectValidator } from "@back-end/src/validators/openapi";
import { GetProjectResponse } from "@back-end/types/openapi";
import {
  findProjectById,
  toProjectApiInterface,
} from "@back-end/src/models/ProjectModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const getProject = createApiRequestHandler(getProjectValidator)(
  async (req): Promise<GetProjectResponse> => {
    const project = await findProjectById(req.context, req.params.id);
    if (!project) {
      throw new Error("Could not find project with that id");
    }

    return {
      project: toProjectApiInterface(project),
    };
  }
);
