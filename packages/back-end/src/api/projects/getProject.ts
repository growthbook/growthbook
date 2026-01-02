import { GetProjectResponse } from "shared/types/openapi";
import { getProjectValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getProject = createApiRequestHandler(getProjectValidator)(async (
  req,
): Promise<GetProjectResponse> => {
  const project = await req.context.models.projects.getById(req.params.id);
  if (!project) {
    throw new Error("Could not find project with that id");
  }

  return {
    project: req.context.models.projects.toApiInterface(project),
  };
});
