import { getContextualBanditSnapshotValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { markLegacyCBRouteDeprecated, requireCBPermission } from "./_shared";

export const getContextualBanditSnapshot = createApiRequestHandler(
  getContextualBanditSnapshotValidator,
)(async (req) => {
  markLegacyCBRouteDeprecated(
    req.res!,
    "/experiments/:id/contextual-bandit/snapshots/:snapshotId",
    "/contextual-bandits/:id/snapshots/:snapshotId",
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
  requireCBPermission(req.context, experiment, "read");

  // PR-8 Commit 2: snapshot collection is now keyed by CB id, not by
  // experiment id. The legacy route URL still carries an experiment id
  // — resolve the paired CB before delegating, then verify the snapshot
  // belongs to that CB. The whole file is deleted in Commit 6.
  const cb = await req.context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (!cb) {
    throw new Error("No contextual bandit found for this experiment");
  }
  const snapshot =
    await req.context.models.contextualBanditSnapshots.getBySnapshotIdInOrg(
      req.params.snapshotId,
    );
  if (!snapshot || snapshot.contextualBandit !== cb.id) {
    throw new Error("Snapshot not found");
  }

  return {
    snapshot: {
      id: snapshot.id,
      contextualBandit: snapshot.contextualBandit,
      phase: snapshot.phase,
      status: snapshot.status,
      weightsWereUpdated: snapshot.weightsWereUpdated,
      contextualBanditEventId: snapshot.contextualBanditEventId,
      error: snapshot.error,
      dateCreated: snapshot.dateCreated.toISOString(),
    },
  };
});
