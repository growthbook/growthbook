import { listCbSnapshotsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadCbForRead } from "./_shared";

export const listCbSnapshots = createApiRequestHandler(
  listCbSnapshotsValidator,
)(async (req) => {
  const { cb } = await loadCbForRead(req.context, req.params.id);
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
