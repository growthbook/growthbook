import { PutProjectResponse } from "shared/types/openapi";
import { putProjectValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { auditDetailsUpdate } from "back-end/src/services/audit";

export const putProject = createApiRequestHandler(putProjectValidator)(async (
  req,
): Promise<PutProjectResponse> => {
  const project = await req.context.models.projects.getById(req.params.id);
  if (!project) {
    throw new Error("Could not find project with that id");
  }

  const newProject = await req.context.models.projects.update(
    project,
    req.context.models.projects.updateValidator.parse(req.body),
  );

  await req.audit({
    event: "project.update",
    entity: {
      object: "project",
      id: project.id,
    },
    details: auditDetailsUpdate(project, newProject),
  });

  return {
    project: req.context.models.projects.toApiInterface(newProject),
  };
});
