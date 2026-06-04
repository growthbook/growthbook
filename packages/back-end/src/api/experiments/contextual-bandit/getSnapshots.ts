import { getContextualBanditSnapshotsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { markLegacyCBRouteDeprecated, requireCBPermission } from "./_shared";

export const getContextualBanditSnapshots = createApiRequestHandler(
  getContextualBanditSnapshotsValidator,
)(async (req) => {
  markLegacyCBRouteDeprecated(
    req.res!,
    "/experiments/:id/contextual-bandit/snapshots",
    "/contextual-bandits/:id/snapshots",
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

  // PR-8 Commit 2: snapshot collection is keyed by CB id now. Resolve
  // the paired CB so we can call the new `listForContextualBandit`
  // method; deleted in Commit 6 alongside this whole file.
  const cb = await req.context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (!cb) {
    return { snapshots: [] };
  }

  const phase = cb.phases.length - 1;
  const limit = req.query?.limit ?? 20;

  const snapshots =
    await req.context.models.contextualBanditSnapshots.listForContextualBandit(
      cb.id,
      phase,
      limit,
    );

  return {
    snapshots: snapshots.map((s) => ({
      id: s.id,
      contextualBandit: s.contextualBandit,
      phase: s.phase,
      status: s.status,
      weightsWereUpdated: s.weightsWereUpdated,
      contextualBanditEventId: s.contextualBanditEventId,
      error: s.error,
      dateCreated: s.dateCreated.toISOString(),
    })),
  };
});
