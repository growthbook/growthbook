import { z } from "zod";
import { GetProjectResponse } from "../../../types/openapi";
import {
  findProjectById,
  toProjectApiInterface,
} from "../../models/ProjectModel";
import { createApiRequestHandler } from "../../util/handler";

export const getProject = createApiRequestHandler({
  paramsSchema: z
    .object({
      id: z.string(),
    })
    .strict(),
})(
  async (req): Promise<GetProjectResponse> => {
    const project = await findProjectById(req.params.id, req.organization.id);
    if (!project) {
      throw new Error("Could not find project with that id");
    }

    return {
      project: toProjectApiInterface(project),
    };
  }
);
