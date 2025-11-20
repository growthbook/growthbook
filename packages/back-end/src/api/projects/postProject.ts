import { generateSlugFromName } from "shared/util";
import { PostProjectResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postProjectValidator } from "back-end/src/validators/openapi";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { refreshSDKPayloadCache } from "back-end/src/services/features";
import { getPayloadKeysForAllEnvs } from "back-end/src/models/ExperimentModel";
import { logger } from "back-end/src/util/logger";

async function generateUniqueProjectUid(
  name: string,
  organization: string,
  checkUnique: (uid: string) => Promise<boolean>,
): Promise<string> {
  // Generate base uid using the same pattern as experiment tracking keys
  let baseUid = generateSlugFromName(name);

  // If empty after stripping, use a default
  if (!baseUid) {
    baseUid = "project";
  }

  // Limit length
  baseUid = baseUid.substring(0, 100);

  // Check if base uid is unique
  let uid = baseUid;
  let counter = 1;
  const maxRetries = 1000;

  while (counter <= maxRetries) {
    const isUnique = await checkUnique(uid);

    if (isUnique) {
      return uid;
    }

    uid = generateSlugFromName(name, counter + 1);
    // Limit length again after adding suffix
    uid = uid.substring(0, 100);
    counter++;
  }

  // Fallback: use timestamp if we've exhausted retries
  return `${baseUid}-${Date.now()}`;
}

export const postProject = createApiRequestHandler(postProjectValidator)(async (
  req,
): Promise<PostProjectResponse> => {
  const payload = req.context.models.projects.createValidator.parse(req.body);

  // Generate uid if not provided (for backwards compatibility with API clients)
  if (!payload.uid) {
    payload.uid = await generateUniqueProjectUid(
      payload.name,
      req.context.org.id,
      async (uid: string) => {
        // Check if a project with this uid already exists
        const existingProjects = await req.context.models.projects.getAll();
        return !existingProjects.some((p) => p.uid === uid);
      },
    );
  }

  const project = await req.context.models.projects.create(payload);

  await req.audit({
    event: "project.create",
    entity: {
      object: "project",
      id: project.id,
    },
    details: auditDetailsCreate(project),
  });

  // Refresh SDK payload cache for all environments that might use this project
  // (only if includeProjectUID is enabled for any connections)
  const payloadKeys = getPayloadKeysForAllEnvs(req.context, [project.id]);
  refreshSDKPayloadCache(req.context, payloadKeys).catch((e) => {
    logger.error(e, "Error refreshing SDK payload cache after project create");
  });

  return {
    project: req.context.models.projects.toApiInterface(project),
  };
});
