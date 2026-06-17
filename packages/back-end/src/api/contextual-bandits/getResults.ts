import { getContextualBanditResultsValidator } from "shared/validators";
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
  const { contextualBanditSnapshot, latestSnapshotSummary } =
    await getContextualBanditResultsForUi(req.context, contextualBandit);
  return {
    contextualBanditSnapshot: contextualBanditSnapshot
      ? {
          attributes: contextualBanditSnapshot.attributes,
          responses: contextualBanditSnapshot.responses,
          leaf_map: contextualBanditSnapshot.leaf_map,
        }
      : null,
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
        }
      : null,
  };
});
