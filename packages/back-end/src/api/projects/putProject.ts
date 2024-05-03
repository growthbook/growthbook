import { PutProjectResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { putProjectValidator } from "../../validators/openapi";

export const putProject = createApiRequestHandler(putProjectValidator)(
  async (req): Promise<PutProjectResponse> => {
    const project = await req.context.models.projects.getById(req.params.id);
    if (!project) {
      throw new Error("Could not find project with that id");
    }

    const newProject = await req.context.models.projects.update(
      project,
      req.body
    );

    return {
      project: req.context.models.projects.toApiInterface(newProject),
    };
  }
);
