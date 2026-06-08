import { getFeatureV2Validator } from "shared/validators";
import { stemRuleId } from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import {
  getFeatureRevisionsByStatus,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { getFeature as getFeatureDB } from "back-end/src/models/FeatureModel";
import {
  getApiFeatureObjV2,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";

async function loadFeatureForApiV2(
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
  const rampSchedules = await context.models.rampSchedules.getAllByFeatureId(
    feature.id,
  );
  const rampScheduleMap = new Map<string, string>();
  for (const schedule of rampSchedules) {
    for (const target of schedule.targets) {
      if (target.ruleId) {
        rampScheduleMap.set(stemRuleId(target.ruleId), schedule.id);
      }
    }
  }
  const revision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
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
    rampScheduleMap,
  };
}

export const getFeatureV2 = createApiRequestHandler(getFeatureV2Validator)(
  async (req) => {
    const data = await loadFeatureForApiV2(
      req.context,
      req.params.id,
      req.query.withRevisions,
    );
    return {
      feature: await resolveOwnerEmail(
        getApiFeatureObjV2({
          ...data,
          organization: req.organization,
        }),
        req.context,
      ),
    };
  },
);
