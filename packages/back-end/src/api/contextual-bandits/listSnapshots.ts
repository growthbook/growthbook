import {
  ContextualBanditSnapshotInterface,
  listContextualBanditSnapshotsValidator,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadContextualBanditForRead } from "./_shared";

export const listContextualBanditSnapshots = createApiRequestHandler(
  listContextualBanditSnapshotsValidator,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );
  const snapshots =
    await req.context.models.contextualBanditSnapshots.listForContextualBandit(
      contextualBandit.id,
      req.query?.limit,
    );
  return {
    snapshots: snapshots.map((s: ContextualBanditSnapshotInterface) => ({
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
