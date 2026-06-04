import { getContextualBanditEventsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { markLegacyCBRouteDeprecated, requireCBPermission } from "./_shared";

export const getContextualBanditEvents = createApiRequestHandler(
  getContextualBanditEventsValidator,
)(async (req) => {
  markLegacyCBRouteDeprecated(
    req.res!,
    "/experiments/:id/contextual-bandit/events",
    "/contextual-bandits/:id/events",
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

  // PR-8 Commit 2: event collection is keyed by CB id now. Deleted with
  // this whole file in Commit 6.
  const cb = await req.context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (!cb) {
    return { events: [] };
  }

  const phase = cb.phases.length - 1;
  const limit = req.query?.limit ?? 20;

  const events =
    await req.context.models.contextualBanditEvents.listForContextualBandit(
      cb.id,
      phase,
      limit,
    );

  return {
    events: events.map((e) => ({
      id: e.id,
      contextualBandit: e.contextualBandit,
      phase: e.phase,
      snapshotId: e.snapshotId,
      weightsWereUpdated: e.weightsWereUpdated,
      dateCreated: e.dateCreated.toISOString(),
    })),
  };
});
