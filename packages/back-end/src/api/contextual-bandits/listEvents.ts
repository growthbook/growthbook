import {
  ContextualBanditEventInterface,
  listContextualBanditEventsValidator,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadContextualBanditForRead } from "./_shared";

export const listContextualBanditEvents = createApiRequestHandler(
  listContextualBanditEventsValidator,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );
  const events =
    await req.context.models.contextualBanditEvents.listForContextualBandit(
      contextualBandit.id,
      req.query?.limit,
    );
  return {
    events: events.map((e: ContextualBanditEventInterface) => ({
      id: e.id,
      contextualBandit: e.contextualBandit,
      snapshotId: e.snapshotId,
      weightsWereUpdated: e.weightsWereUpdated,
      degreesOfFreedom: e.degreesOfFreedom,
      dateCreated: e.dateCreated.toISOString(),
    })),
  };
});
