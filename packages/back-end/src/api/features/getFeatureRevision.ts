import { getFeatureRevisionValidator } from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import { toApiRevision } from "back-end/src/services/features";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";

export async function loadRevision(
  context: ApiReqContext,
  organizationId: string,
  featureId: string,
  version: number,
) {
  const feature = await getFeature(context, featureId);
  if (!feature) throw new NotFoundError("Could not find feature");

  const revision = await getRevision({
    context,
    organization: organizationId,
    featureId: feature.id,
    feature,
    version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  return { feature, revision };
}

export const getFeatureRevision = createApiRequestHandler(
  getFeatureRevisionValidator,
)(async (req) => {
  const { feature, revision } = await loadRevision(
    req.context,
    req.organization.id,
    req.params.id,
    req.params.version,
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
