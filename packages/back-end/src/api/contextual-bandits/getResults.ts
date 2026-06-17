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
  const { contextualBanditSnapshot, latest } =
    await getContextualBanditResultsForUi(req.context, contextualBandit);
  return {
    contextualBanditSnapshot: contextualBanditSnapshot
      ? {
          attributes: contextualBanditSnapshot.attributes,
          responses: contextualBanditSnapshot.responses,
          leaf_map: contextualBanditSnapshot.leaf_map,
        }
      : null,
    latest: latest
      ? {
          id: latest.id,
          status: latest.status,
          error: latest.error ?? "",
          queries: latest.queries,
          runStarted: latest.runStarted
            ? latest.runStarted.toISOString()
            : null,
          dateCreated: latest.dateCreated.toISOString(),
          multipleExposures: latest.multipleExposures,
          type: latest.type ?? "standard",
          triggeredBy: latest.triggeredBy ?? "manual",
        }
      : null,
  };
});
