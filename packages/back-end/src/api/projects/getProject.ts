import { getProjectValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getProject = createApiRequestHandler(getProjectValidator)(async (
  req,
) => {
  const project = await req.context.models.projects.getById(req.params.id);
  if (!project) {
    throw new Error("Could not find project with that id");
  }

  return {
    project: await resolveOwnerEmail(
      req.context.models.projects.toApiInterface(project),
      req.context,
    ),
  };
});
