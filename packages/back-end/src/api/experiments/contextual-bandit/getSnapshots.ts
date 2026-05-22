import { getContextualBanditSnapshotsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getContextualBanditSnapshots = createApiRequestHandler(
  getContextualBanditSnapshotsValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (!experiment.banditIsContextual) {
    throw new Error("Experiment is not a contextual bandit");
  }

  const phase = experiment.phases.length - 1;
  const limit = req.query?.limit ?? 20;

  const snapshots =
    await req.context.contextualBanditSnapshots.listForExperiment(
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
