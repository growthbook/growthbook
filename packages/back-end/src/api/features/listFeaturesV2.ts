import { listFeaturesV2Validator } from "shared/validators";
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
