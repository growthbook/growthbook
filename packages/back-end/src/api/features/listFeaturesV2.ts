import { listFeaturesV2Validator } from "shared/validators";
import { stemRuleId } from "shared/util";
import { getApiFeatureObjV2 } from "back-end/src/services/features";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadFeaturesPage } from "./listFeatures";

export const listFeaturesV2 = createApiRequestHandler(listFeaturesV2Validator)(
  async (req) => {
    const r = await loadFeaturesPage(
      req.context,
      req.organization.id,
      req.query,
    );
    if (r.empty) return r.response;
    const rampSchedules =
      await req.context.models.rampSchedules.getAllByFeatureIds(
        r.filtered.map((f) => f.id),
      );
    const rampScheduleMap = new Map<string, string>();
    for (const schedule of rampSchedules) {
      for (const target of schedule.targets) {
        if (target.ruleId) {
          rampScheduleMap.set(stemRuleId(target.ruleId), schedule.id);
        }
      }
    }
    return {
      features: await resolveOwnerEmails(
        r.filtered.map((feature) => {
          const revision =
            r.revisions?.find(
              (x) =>
                x.featureId === feature.id && x.version === feature.version,
            ) || null;
          return getApiFeatureObjV2({
            feature,
            organization: req.organization,
            groupMap: r.groupMap,
            experimentMap: r.experimentMap,
            revision,
            safeRolloutMap: r.safeRolloutMap,
            rampScheduleMap,
          });
        }),
        req.context,
      ),
      limit: r.outLimit,
      offset: r.outOffset,
      count: r.filtered.length,
      total: r.total,
      hasMore: r.hasMore,
      nextOffset: r.nextOffset,
    };
  },
);
