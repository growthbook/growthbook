import { PutProjectResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { putProjectValidator } from "back-end/src/validators/openapi";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { refreshSDKPayloadCache } from "back-end/src/services/features";
import { getPayloadKeysForAllEnvs } from "back-end/src/models/ExperimentModel";
import { logger } from "back-end/src/util/logger";

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

  // Refresh SDK payload cache if UID changed (affects metadata in payloads)
  // Also refresh on any update to ensure consistency
  const payloadKeys = getPayloadKeysForAllEnvs(req.context, [project.id]);
  refreshSDKPayloadCache(req.context, payloadKeys).catch((e) => {
    logger.error(e, "Error refreshing SDK payload cache after project update");
  });

  return {
    project: req.context.models.projects.toApiInterface(newProject),
  };
});
