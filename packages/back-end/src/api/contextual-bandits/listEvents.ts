import { listCbEventsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadCbForRead } from "./_shared";

export const listCbEvents = createApiRequestHandler(listCbEventsValidator)(
  async (req) => {
    const { cb } = await loadCbForRead(req.context, req.params.id);
    const limit = req.query?.limit ?? 20;
    const events =
      await req.context.models.contextualBanditEvents.listForContextualBandit(
        cb.id,
        limit,
      );
    return {
      events: events.map((e) => ({
        id: e.id,
        contextualBandit: e.contextualBandit,
        snapshotId: e.snapshotId,
        weightsWereUpdated: e.weightsWereUpdated,
        dateCreated: e.dateCreated.toISOString(),
      })),
    };
  },
);
