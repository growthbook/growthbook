import { getFeatureValidator } from "shared/validators";
import {
  getFeatureRevisionsByStatus,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { getFeature as getFeatureDB } from "back-end/src/models/FeatureModel";
import {
  getApiFeatureObj,
  getFeatureDefinitionLookups,
} from "back-end/src/services/features";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getFeature = createApiRequestHandler(getFeatureValidator)(async (
  req,
) => {
  const revisionFilter = req.query.withRevisions || "none";
  const fetchRevisions = ["all", "drafts", "published"].includes(
    revisionFilter || "none",
  );
  const feature = await getFeatureDB(req.context, req.params.id);
  if (!feature) {
    throw new Error("Could not find a feature with that key");
  }

  const experimentMap = await getExperimentMapForFeature(
    req.context,
    feature.id,
  );
  const revision = await getRevision({
    context: req.context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
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
  const { groupMap, safeRolloutMap } = await getFeatureDefinitionLookups(
    req.context,
    {
      features: [feature],
      revisions,
      experiments: [...experimentMap.values()],
    },
  );
  return {
    feature: await resolveOwnerEmail(
      getApiFeatureObj({
        feature,
        organization: req.organization,
        groupMap,
        experimentMap,
        revision,
        revisions,
        safeRolloutMap,
      }),
      req.context,
    ),
  };
});
