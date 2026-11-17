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
  // fields this endpoint doesn't accept, like the default dashboard. This
  // endpoint owns the stats fields, so one left out of the request is cleared.
  const newProject = settings
    ? await req.context.models.projects.updateWithCas(
        project.id,
        ["settings"],
        (current) => ({
          ...updates,
          settings: {
            ...current.settings,
            statsEngine: settings.statsEngine,
            confidenceLevel: settings.confidenceLevel,
            pValueThreshold: settings.pValueThreshold,
          },
        }),
      )
    : await req.context.models.projects.update(project, updates);
  if (!newProject) {
    throw new Error("Could not find project with that id");
  }

  return {
    project: await resolveOwnerEmail(
      req.context.models.projects.toApiInterface(newProject),
      req.context,
    ),
  };
});
