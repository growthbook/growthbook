import { getContextualBanditCurrentValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { markLegacyCBRouteDeprecated, requireCBPermission } from "./_shared";

export const getContextualBanditCurrent = createApiRequestHandler(
  getContextualBanditCurrentValidator,
)(async (req) => {
  markLegacyCBRouteDeprecated(
    req.res!,
    "/experiments/:id/contextual-bandit/current",
    "/contextual-bandits/:id/current",
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

  const cb = await req.context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );

  const phase = experiment.phases.length - 1;
  const latestCBE =
    await req.context.models.contextualBanditEvents.getLatestForExperiment(
      experiment.id,
      phase,
    );

  const phaseWeights = cb?.phases[phase]?.currentLeafWeights;

  return {
    phaseWeights: phaseWeights ?? [],
    latestEvent: latestCBE
      ? {
          id: latestCBE.id,
          experiment: latestCBE.experiment,
          phase: latestCBE.phase,
          snapshotId: latestCBE.snapshotId,
          weightsWereUpdated: latestCBE.weightsWereUpdated,
          dateCreated: latestCBE.dateCreated.toISOString(),
        }
      : null,
  };
});
