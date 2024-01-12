import { GetProjectResponse } from "../../../types/openapi";
import {
  findProjectById,
  toProjectApiInterface,
} from "../../models/ProjectModel";
import { createApiRequestHandler } from "../../util/handler";
import { getProjectValidator } from "../../validators/openapi";

export const getProject = createApiRequestHandler(getProjectValidator)(
  async (req): Promise<GetProjectResponse> => {
    const project = await findProjectById(
      req.params.id,
      req.organization.id,
      req.readAccessFilter
    );
    if (!project) {
      throw new Error("Could not find project with that id");
    }

    return {
      project: toProjectApiInterface(project),
    };
  }
);
