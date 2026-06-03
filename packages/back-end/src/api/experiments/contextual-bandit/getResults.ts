import { getContextualBanditResultsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getContextualBanditResultsForUi } from "back-end/src/enterprise/services/contextualBandits";
import { markLegacyCBRouteDeprecated, requireCBPermission } from "./_shared";

export const getContextualBanditResults = createApiRequestHandler(
  getContextualBanditResultsValidator,
)(async (req) => {
  markLegacyCBRouteDeprecated(
    req.res!,
    "/experiments/:id/contextual-bandit/results",
    "/contextual-bandits/:id/results",
  );

  if (!req.context.hasPremiumFeature("contextual-bandits")) {
    req.context.throwPlanDoesNotAllowError(
      "Contextual Bandits require an Enterprise plan.",
    );
  }

  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (experiment.type !== "contextual-bandit") {
    throw new Error("Experiment is not a contextual bandit");
  }
  requireCBPermission(req.context, experiment, "read");

  const { contextualBanditSnapshot, latest } =
    await getContextualBanditResultsForUi(req.context, experiment);

  return {
    contextualBanditSnapshot: contextualBanditSnapshot
      ? {
          attributes: contextualBanditSnapshot.attributes,
          responses: contextualBanditSnapshot.responses,
          leaf_map: contextualBanditSnapshot.leaf_map,
        }
      : null,
    // Normalize Date fields to ISO strings so the wire shape matches the
    // OpenAPI spec and is consistent with the other CB endpoints (which all
    // emit `dateCreated` as `.toISOString()`).
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
