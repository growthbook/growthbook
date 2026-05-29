import { getContextualBanditEventsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireCBPermission } from "./_shared";

export const getContextualBanditEvents = createApiRequestHandler(
  getContextualBanditEventsValidator,
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
  requireCBPermission(req.context, experiment, "read");

  const phase = experiment.phases.length - 1;
  const limit = req.query?.limit ?? 20;

  const events =
    await req.context.models.contextualBanditEvents.listForExperiment(
      experiment.id,
      phase,
      limit,
    );

  return {
    events: events.map((e) => ({
      id: e.id,
      experiment: e.experiment,
      phase: e.phase,
      snapshotId: e.snapshotId,
      weightsWereUpdated: e.weightsWereUpdated,
      dateCreated: e.dateCreated.toISOString(),
    })),
  };
});
