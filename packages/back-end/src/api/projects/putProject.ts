import { putProjectValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

export const putProject = createApiRequestHandler(putProjectValidator)(async (
  req,
) => {
  const project = await req.context.models.projects.getById(req.params.id);
  if (!project) {
    throw new NotFoundError("Could not find project with that id");
  }

  const { settings, ...updates } =
    req.context.models.projects.updateValidator.parse(req.body);
  // A plain update replaces the whole settings object, which would delete
  // fields this endpoint doesn't accept, like the default dashboard.
  const newProject = settings
    ? await req.context.models.projects.updateStatsSettings(
        project.id,
        settings,
        updates,
      )
    : await req.context.models.projects.update(project, updates);

  return {
    project: await resolveOwnerEmail(
      req.context.models.projects.toApiInterface(newProject),
      req.context,
    ),
  };
});
