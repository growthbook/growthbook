import { postContextualBanditRefreshValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { runContextualBanditSnapshot } from "back-end/src/enterprise/services/contextualBandits";
import { markLegacyCBRouteDeprecated, requireCBPermission } from "./_shared";

export const postContextualBanditRefresh = createApiRequestHandler(
  postContextualBanditRefreshValidator,
)(async (req) => {
  markLegacyCBRouteDeprecated(
    req.res!,
    "/experiments/:id/contextual-bandit/refresh",
    "/contextual-bandits/:id/refresh",
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
  requireCBPermission(req.context, experiment, "run");
  if (!experiment.phases.length) {
    throw new Error("Experiment has no phases");
  }

  const phase = experiment.phases.length - 1;

  // The orchestrator takes a CB directly post-PR-8-Commit-1; this legacy
  // route receives an experiment id from the URL, so resolve the paired
  // CB via the FK before handing off. The whole legacy route file is
  // deleted in Commit 6.
  const cb = await req.context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (!cb) {
    throw new Error("No contextual bandit found for this experiment");
  }

  const result = await runContextualBanditSnapshot(req.context, cb, phase, {
    triggeredBy: "manual",
  });

  return result;
});
