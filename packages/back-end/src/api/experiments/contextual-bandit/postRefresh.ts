import { postContextualBanditRefreshValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { runContextualBanditSnapshot } from "back-end/src/services/contextualBandits";

export const postContextualBanditRefresh = createApiRequestHandler(
  postContextualBanditRefreshValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (!experiment.banditIsContextual) {
    throw new Error("Experiment is not a contextual bandit");
  }
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
