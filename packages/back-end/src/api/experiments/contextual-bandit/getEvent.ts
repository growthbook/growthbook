import { getContextualBanditEventValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { markLegacyCBRouteDeprecated, requireCBPermission } from "./_shared";

export const getContextualBanditEvent = createApiRequestHandler(
  getContextualBanditEventValidator,
)(async (req) => {
  markLegacyCBRouteDeprecated(
    req.res!,
    "/experiments/:id/contextual-bandit/events/:eventId",
    "/contextual-bandits/:id/events/:eventId",
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
    throw new Error("No contextual bandit found for this experiment");
  }

  const events =
    await req.context.models.contextualBanditEvents.listForContextualBandit(
      cb.id,
      cb.phases.length - 1,
      100,
    );

  const event = events.find((e) => e.id === req.params.eventId);
  if (!event || event.contextualBandit !== cb.id) {
    throw new Error("Event not found");
  }

  return {
    event: {
      id: event.id,
      contextualBandit: event.contextualBandit,
      phase: event.phase,
      snapshotId: event.snapshotId,
      weightsWereUpdated: event.weightsWereUpdated,
      dateCreated: event.dateCreated.toISOString(),
    },
  };
});
