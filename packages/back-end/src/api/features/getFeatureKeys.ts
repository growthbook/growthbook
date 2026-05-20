import { getFeatureKeysValidator } from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export async function listFeatureKeys(
  context: ApiReqContext,
  projectId?: string,
) {
  const features = await getAllFeatures(context, {
    projects: projectId ? [projectId] : undefined,
  });
  return features.map((f) => f.id);
}

export const getFeatureKeys = createApiRequestHandler(getFeatureKeysValidator)(
  async (req) => listFeatureKeys(req.context, req.query.projectId),
);
