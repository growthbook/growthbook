import { getCbResultsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getContextualBanditResultsForUi } from "back-end/src/enterprise/services/contextualBandits";
import { loadCbForRead } from "./_shared";

export const getCbResults = createApiRequestHandler(getCbResultsValidator)(
  async (req) => {
    const { cb } = await loadCbForRead(req.context, req.params.id);
    const { contextualBanditSnapshot, latest } =
      await getContextualBanditResultsForUi(req.context, cb);
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
  },
);
