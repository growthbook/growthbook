import { listContextualBanditEventsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadContextualBanditForRead } from "./_shared";

export const listContextualBanditEvents = createApiRequestHandler(
  listContextualBanditEventsValidator,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );
  const limit = req.query?.limit ?? 20;
  const events =
    await req.context.models.contextualBanditEvents.listForContextualBandit(
      contextualBandit.id,
      limit,
    );
  return {
    events: events.map((e) => ({
      id: e.id,
      contextualBandit: e.contextualBandit,
      snapshotId: e.snapshotId,
      weightsWereUpdated: e.weightsWereUpdated,
      degreesOfFreedom: e.degreesOfFreedom,
      dateCreated: e.dateCreated.toISOString(),
    })),
  };
});
