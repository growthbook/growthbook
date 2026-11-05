import { postProjectValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postProject = createApiRequestHandler(postProjectValidator)(async (
  req,
) => {
  const payload = req.context.models.projects.createValidator.parse(req.body);
  const project = await req.context.models.projects.create(payload);

  return {
    project: await resolveOwnerEmail(
      req.context.models.projects.toApiInterface(project),
      req.context,
    ),
  };
});
