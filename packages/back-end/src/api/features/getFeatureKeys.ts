import { getFeatureKeysValidator } from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import { getAllFeatureIds } from "back-end/src/models/FeatureModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export async function listFeatureKeys(
  context: ApiReqContext,
  projectId?: string,
) {
  return getAllFeatureIds(context, {
    projects: projectId ? [projectId] : undefined,
  });
}

export const getFeatureKeys = createApiRequestHandler(getFeatureKeysValidator)(
  async (req) => listFeatureKeys(req.context, req.query.projectId),
);
