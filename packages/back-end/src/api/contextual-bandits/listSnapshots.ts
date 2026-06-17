import { listContextualBanditSnapshotsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadContextualBanditForRead } from "./_shared";

export const listContextualBanditSnapshots = createApiRequestHandler(
  listContextualBanditSnapshotsValidator,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );
  const DEFAULT_CONTEXTUAL_BANDIT_SNAPSHOT_LIMIT = 20;
  const limit = req.query?.limit ?? DEFAULT_CONTEXTUAL_BANDIT_SNAPSHOT_LIMIT;
  const snapshots =
    await req.context.models.contextualBanditSnapshots.listForContextualBandit(
      contextualBandit.id,
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
