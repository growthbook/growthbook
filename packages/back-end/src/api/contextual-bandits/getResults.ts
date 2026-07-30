import { getContextualBanditResultsValidator } from "shared/validators";
import {
  buildContextualBanditResultsView,
  computeOverallVariationWeights,
} from "shared/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getContextualBanditResultsForUi } from "back-end/src/enterprise/services/contextualBandits";
import { loadContextualBanditForRead } from "./_shared";

export const getContextualBanditResults = createApiRequestHandler(
  getContextualBanditResultsValidator,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );
  const { contextualBanditSnapshot, latestSnapshotSummary, srm } =
    await getContextualBanditResultsForUi(req.context, contextualBandit);

  const overallWeights = contextualBanditSnapshot
    ? computeOverallVariationWeights(
        contextualBanditSnapshot.responses,
        contextualBandit.variations.length,
      ).map((weight, i) => ({
        variationId: contextualBandit.variations[i].id,
        weight,
      }))
    : null;

  const results = contextualBanditSnapshot
    ? buildContextualBanditResultsView(
        contextualBanditSnapshot,
        contextualBandit.variations,
      )
    : null;

  return {
    contextualBanditSnapshot: contextualBanditSnapshot
      ? {
          attributes: contextualBanditSnapshot.attributes,
          responses: contextualBanditSnapshot.responses,
          leaf_map: contextualBanditSnapshot.leaf_map,
          leaf_stats: contextualBanditSnapshot.leaf_stats,
          sse_trajectory: contextualBanditSnapshot.sse_trajectory,
        }
      : null,
    overallWeights,
    results,
    latest: latestSnapshotSummary
      ? {
          id: latestSnapshotSummary.id,
          status: latestSnapshotSummary.status,
          error: latestSnapshotSummary.error ?? "",
          queries: latestSnapshotSummary.queries,
          runStarted: latestSnapshotSummary.runStarted
            ? latestSnapshotSummary.runStarted.toISOString()
            : null,
          dateCreated: latestSnapshotSummary.dateCreated.toISOString(),
          multipleExposures: latestSnapshotSummary.multipleExposures,
          type: latestSnapshotSummary.type ?? "standard",
          triggeredBy: latestSnapshotSummary.triggeredBy ?? "manual",
          srm: srm
            ? {
                statistic: srm.statistic,
                pValue: srm.pValue,
                degreesOfFreedom: srm.degreesOfFreedom,
              }
            : null,
        }
      : null,
  };
});
