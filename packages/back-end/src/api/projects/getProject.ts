import { getProjectValidator } from "@/src/validators/openapi";
import { GetProjectResponse } from "@/types/openapi";
import {
  findProjectById,
  toProjectApiInterface,
} from "@/src/models/ProjectModel";
import { createApiRequestHandler } from "@/src/util/handler";

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
