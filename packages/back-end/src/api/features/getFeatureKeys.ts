import { getFeatureKeysValidator } from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";

export async function listFeatureKeys(
  context: ApiReqContext,
  projectId?: string,
) {
  const features = await context.models.features.getAll({
    projects: projectId ? [projectId] : undefined,
  });
  return features.map((f) => f.id);
}

export const getFeatureKeys = createApiRequestHandler(getFeatureKeysValidator)(
  async (req) => listFeatureKeys(req.context, req.query.projectId),
);
