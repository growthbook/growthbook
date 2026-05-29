import { postContextualBanditRefreshValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { runContextualBanditSnapshot } from "back-end/src/enterprise/services/contextualBandits";
import { requireCBPermission } from "./_shared";

export const postContextualBanditRefresh = createApiRequestHandler(
  postContextualBanditRefreshValidator,
)(async (req) => {
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
  requireCBPermission(req.context, experiment, "run");
  if (!experiment.phases.length) {
    throw new Error("Experiment has no phases");
  }

  const phase = experiment.phases.length - 1;

  const result = await runContextualBanditSnapshot(
    req.context,
    experiment,
    phase,
    { triggeredBy: "manual" },
  );

  return result;
});
