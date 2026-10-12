import { putProjectValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const putProject = createApiRequestHandler(putProjectValidator)(async (
  req,
) => {
  const project = await req.context.models.projects.getById(req.params.id);
  if (!project) {
    throw new Error("Could not find project with that id");
  }

  const updates = req.context.models.projects.updateValidator.parse(req.body);
  // The public API only exposes the stats settings — merge over the existing
  // settings so internal-only fields (e.g. the quality-score config) survive
  if (updates.settings) {
    updates.settings = { ...project.settings, ...updates.settings };
  }

  const newProject = await req.context.models.projects.update(project, updates);

  return {
    project: await resolveOwnerEmail(
      req.context.models.projects.toApiInterface(newProject),
      req.context,
    ),
  };
});
