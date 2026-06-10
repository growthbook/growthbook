import { listCbSnapshotsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadCbForRead } from "./_shared";

export const listCbSnapshots = createApiRequestHandler(
  listCbSnapshotsValidator,
)(async (req) => {
  const { cb } = await loadCbForRead(req.context, req.params.id);
  const limit = req.query?.limit ?? 20;
  const snapshots =
    await req.context.models.contextualBanditSnapshots.listForContextualBandit(
      cb.id,
      limit,
    );
  return {
    snapshots: snapshots.map((s) => ({
      id: s.id,
      contextualBandit: s.contextualBandit,
      status: s.status,
      weightsWereUpdated: s.weightsWereUpdated,
      contextualBanditEventId: s.contextualBanditEventId,
      error: s.error,
      dateCreated: s.dateCreated.toISOString(),
    })),
  };
});
