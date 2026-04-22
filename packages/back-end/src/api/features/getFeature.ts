import { getFeatureValidator, getFeatureV2Validator } from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import {
  getFeatureRevisionsByStatus,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { getFeature as getFeatureDB } from "back-end/src/models/FeatureModel";
import {
  getApiFeatureObj,
  getApiFeatureObjV2,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";

// Shared core. Returns everything both v1 and v2 serializers need; callers only
// differ in which `getApiFeatureObj*` they pass the result through.
async function loadFeatureForApi(
  context: ApiReqContext,
  featureId: string,
  withRevisions: string | undefined,
) {
  const revisionFilter = withRevisions || "none";
  const fetchRevisions = ["all", "drafts", "published"].includes(
    revisionFilter,
  );
  const feature = await getFeatureDB(context, featureId);
  if (!feature) {
    throw new Error("Could not find a feature with that key");
  }
  const groupMap = await getSavedGroupMap(context);
  const experimentMap = await getExperimentMapForFeature(context, feature.id);
  const safeRolloutMap =
    await context.models.safeRollout.getAllPayloadSafeRollouts();
  const revision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    version: feature.version,
  });
  const revisions = fetchRevisions
    ? await getFeatureRevisionsByStatus({
        context,
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
    feature,
    groupMap,
    experimentMap,
    revision,
    revisions,
    safeRolloutMap,
  };
}

export const getFeature = createApiRequestHandler(getFeatureValidator)(async (
  req,
) => {
  const data = await loadFeatureForApi(
    req.context,
    req.params.id,
    req.query.withRevisions,
  );
  return {
    feature: getApiFeatureObj({
      ...data,
      organization: req.organization,
    }),
  };
});

export const getFeatureV2 = createApiRequestHandler(getFeatureV2Validator)(
  async (req) => {
    const data = await loadFeatureForApi(
      req.context,
      req.params.id,
      req.query.withRevisions,
    );
    return {
      feature: getApiFeatureObjV2({
        ...data,
        organization: req.organization,
      }),
    };
  },
);
