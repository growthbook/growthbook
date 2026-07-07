import { postProjectValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postProject = createApiRequestHandler(postProjectValidator)(async (
  req,
) => {
  const payload = req.context.models.projects.createValidator.parse(req.body);
  const project = await req.context.models.projects.create(payload);

  return {
    project: req.context.models.projects.toApiInterface(project),
  };
});
