import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getContextualBanditStatusForUi } from "back-end/src/enterprise/services/contextualBandits";
import { loadContextualBanditForRead } from "./_shared";

export const getContextualBanditStatus = createApiRequestHandler(
  contextualBanditEndpoints.getContextualBanditStatus,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );

  const latestSnapshotSummary = await getContextualBanditStatusForUi(
    req.context,
    contextualBandit,
  );

  return {
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
