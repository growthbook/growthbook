import { getContextualBanditSnapshotValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireCBPermission } from "./_shared";

export const getContextualBanditSnapshot = createApiRequestHandler(
  getContextualBanditSnapshotValidator,
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
  requireCBPermission(req.context, experiment, "read");

  const snapshot =
    await req.context.models.contextualBanditSnapshots.getBySnapshotIdInOrg(
      req.params.snapshotId,
    );
  if (!snapshot || snapshot.experiment !== experiment.id) {
    throw new Error("Snapshot not found");
  }

  return {
    snapshot: {
      id: snapshot.id,
      experiment: snapshot.experiment,
      phase: snapshot.phase,
      status: snapshot.status,
      weightsWereUpdated: snapshot.weightsWereUpdated,
      contextualBanditEventId: snapshot.contextualBanditEventId,
      error: snapshot.error,
      dateCreated: snapshot.dateCreated.toISOString(),
    },
  };
});
