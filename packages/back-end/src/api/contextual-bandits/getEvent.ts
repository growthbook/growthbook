import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadContextualBanditForRead } from "./_shared";

export const getContextualBanditEvent = createApiRequestHandler(
  contextualBanditEndpoints.getContextualBanditEvent,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );
  const event = await req.context.models.contextualBanditEvents.getEventById(
    req.params.eventId,
  );
  if (!event || event.contextualBandit !== contextualBandit.id) {
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
