import { PostProjectResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postProjectValidator } from "../../validators/openapi";

export const postProject = createApiRequestHandler(postProjectValidator)(
  async (req): Promise<PostProjectResponse> => {
    const project = await req.context.models.projects.create(req.body);

    return {
      project: req.context.models.projects.toApiInterface(project),
    };
  }
);
