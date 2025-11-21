import { generateSlugFromName } from "shared/util";
import { PostProjectResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postProjectValidator } from "back-end/src/validators/openapi";
import { auditDetailsCreate } from "back-end/src/services/audit";

export const postProject = createApiRequestHandler(postProjectValidator)(async (
  req,
): Promise<PostProjectResponse> => {
  const body = req.body;

  // Generate uid from name if not provided
  const uid = body?.uid || generateSlugFromName(body.name);
  if (!uid) {
    throw new Error("Unable to generate project uid");
  }

  const payload = req.context.models.projects.createValidator.parse({
    ...body,
    uid,
  });

  const project = await req.context.models.projects.create(payload);

  await req.audit({
    event: "project.create",
    entity: {
      object: "project",
      id: project.id,
    },
    details: auditDetailsCreate(project),
  });

  return {
    project: req.context.models.projects.toApiInterface(project),
  };
});
