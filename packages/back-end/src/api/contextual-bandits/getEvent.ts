import { getCbEventValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadCbForRead } from "./_shared";

export const getCbEvent = createApiRequestHandler(getCbEventValidator)(async (
  req,
) => {
  const { cb, experiment } = await loadCbForRead(req.context, req.params.id);
  if (!experiment) return req.context.throwNotFoundError();
  // The event collection doesn't have a getById; pull the recent window
  // for the current phase (up to 100) and filter. Matches the legacy
  // /experiments/:id/contextual-bandit/events/:eventId handler exactly.
  const events =
    await req.context.models.contextualBanditEvents.listForExperiment(
      experiment.id,
      cb.phases.length - 1,
      100,
    );
  const event = events.find((e) => e.id === req.params.eventId);
  if (!event || event.experiment !== experiment.id) {
    return req.context.throwNotFoundError();
  }
  return {
    event: {
      id: event.id,
      experiment: event.experiment,
      phase: event.phase,
      snapshotId: event.snapshotId,
      weightsWereUpdated: event.weightsWereUpdated,
      dateCreated: event.dateCreated.toISOString(),
    },
  };
});
