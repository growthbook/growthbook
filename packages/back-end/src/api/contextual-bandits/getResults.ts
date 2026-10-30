import { contextualBanditEndpoints } from "shared/api-endpoints";
import {
  buildContextualBanditResultsView,
  computeOverallVariationWeights,
  resolveSnapshotVariations,
} from "shared/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getContextualBanditResultsForUi } from "back-end/src/enterprise/services/contextualBandits";
import {
  loadContextualBanditForRead,
  toApiContextualBanditLatestStatus,
} from "./_shared";

export const getContextualBanditResults = createApiRequestHandler(
  contextualBanditEndpoints.getContextualBanditResults,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );
  const {
    contextualBanditSnapshot,
    latestSnapshotSummary,
    snapshotVariationIds,
    resultsRun,
    health,
  } = await getContextualBanditResultsForUi(req.context, contextualBandit);

  const snapshotVariations = resolveSnapshotVariations(
    snapshotVariationIds ?? [],
    contextualBandit.variations,
  );

  const overallWeights = contextualBanditSnapshot
    ? computeOverallVariationWeights(
        contextualBanditSnapshot.responses,
        snapshotVariations.length,
      ).map((weight, i) => ({
        variationId: snapshotVariations[i].id,
        weight,
      }))
    : null;

  const healthView = health
    ? {
        variations: health.variations.map((v) => {
          const match = contextualBandit.variations.find(
            (cv) => cv.id === v.id,
          );
          return {
            variationId: v.id,
            ...(match?.name !== undefined ? { variationName: match.name } : {}),
            weight: v.weight,
          };
        }),
        traffic: health.traffic,
        srm: health.srm
          ? {
              statistic: health.srm.statistic,
              pValue: health.srm.pValue,
              degreesOfFreedom: health.srm.degreesOfFreedom,
              ...(health.srm.latestPeriod
                ? { latestPeriod: health.srm.latestPeriod }
                : {}),
            }
          : null,
        multipleExposures: health.multipleExposures,
      }
    : null;

  const results =
    contextualBanditSnapshot && resultsRun
      ? {
          ...buildContextualBanditResultsView(
            contextualBanditSnapshot,
            snapshotVariations,
          ),
          snapshotId: resultsRun.snapshotId,
          dateCreated: resultsRun.dateCreated.toISOString(),
          health: healthView,
        }
      : null;

  return {
    contextualBanditSnapshot: contextualBanditSnapshot
      ? {
          attributes: contextualBanditSnapshot.attributes,
          responses: contextualBanditSnapshot.responses,
          leaf_map: contextualBanditSnapshot.leaf_map,
          leaf_stats: contextualBanditSnapshot.leaf_stats,
          sse_trajectory: contextualBanditSnapshot.sse_trajectory,
          bic_trajectory: contextualBanditSnapshot.bic_trajectory,
        }
      : null,
    overallWeights,
    results,
    latest: toApiContextualBanditLatestStatus(latestSnapshotSummary),
  };
});
