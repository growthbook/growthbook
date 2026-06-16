import { getCbEventValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadCbForRead } from "./_shared";

export const getCbEvent = createApiRequestHandler(getCbEventValidator)(async (
  req,
) => {
  const { cb } = await loadCbForRead(req.context, req.params.id);
  // No getById on events; pull the recent window and filter.
  const events =
    await req.context.models.contextualBanditEvents.listForContextualBandit(
      cb.id,
      100,
    );
  const event = events.find((e) => e.id === req.params.eventId);
  if (!event || event.contextualBandit !== cb.id) {
    return req.context.throwNotFoundError();
  }
  return {
    event: {
      id: event.id,
      contextualBandit: event.contextualBandit,
      snapshotId: event.snapshotId,
      weightsWereUpdated: event.weightsWereUpdated,
      degreesOfFreedom: event.degreesOfFreedom,
      dateCreated: event.dateCreated.toISOString(),
    },
  };
});
