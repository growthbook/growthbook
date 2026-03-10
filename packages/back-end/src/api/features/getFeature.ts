import { GetFeatureResponse } from "shared/types/openapi";
import { getFeatureValidator } from "shared/validators";
import {
  getFeatureRevisionsByStatus,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { getFeature as getFeatureDB } from "back-end/src/models/FeatureModel";
import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getFeature = createApiRequestHandler(getFeatureValidator)(async (
  req,
): Promise<GetFeatureResponse> => {
  const revisionFilter = req.query.withRevisions || "none";
  const fetchRevisions = ["all", "drafts", "published"].includes(
    revisionFilter || "none",
  );
  const feature = await getFeatureDB(req.context, req.params.id);
  if (!feature) {
    throw new Error("Could not find a feature with that key");
  }

  const groupMap = await getSavedGroupMap(req.context);
  const experimentMap = await getExperimentMapForFeature(
    req.context,
    feature.id,
  );
  const safeRolloutMap =
    await req.context.models.safeRollout.getAllPayloadSafeRollouts();
  const revision = await getRevision({
    context: req.context,
    organization: feature.organization,
    featureId: feature.id,
    version: feature.version,
  });
  const revisions = fetchRevisions
    ? await getFeatureRevisionsByStatus({
        context: req.context,
        organization: feature.organization,
        featureId: feature.id,
        status:
          revisionFilter === "drafts"
            ? "draft"
            : revisionFilter === "published"
              ? "published"
              : undefined,
      })
    : undefined;
  return {
    feature: getApiFeatureObj({
      feature,
      organization: req.organization,
      groupMap,
      experimentMap,
      revision,
      revisions,
      safeRolloutMap,
    }),
  };
});
