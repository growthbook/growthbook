import { getContextualBanditSnapshotsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireCBPermission } from "./_shared";

export const getContextualBanditSnapshots = createApiRequestHandler(
  getContextualBanditSnapshotsValidator,
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

  const snapshots =
    await req.context.models.contextualBanditSnapshots.listForExperiment(
      experiment.id,
      phase,
      limit,
    );

  return {
    snapshots: snapshots.map((s) => ({
      id: s.id,
      experiment: s.experiment,
      phase: s.phase,
      status: s.status,
      weightsWereUpdated: s.weightsWereUpdated,
      contextualBanditEventId: s.contextualBanditEventId,
      error: s.error,
      dateCreated: s.dateCreated.toISOString(),
    })),
  };
});
