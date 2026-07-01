import { getContextualBanditSnapshotValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadContextualBanditForRead } from "./_shared";

export const getContextualBanditSnapshot = createApiRequestHandler(
  getContextualBanditSnapshotValidator,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );
  const snapshot =
    await req.context.models.contextualBanditSnapshots.getBySnapshotIdInOrg(
      req.params.snapshotId,
    );
  if (!snapshot || snapshot.contextualBandit !== contextualBandit.id) {
    return req.context.throwNotFoundError();
  }
  return {
    snapshot: {
      id: snapshot.id,
      contextualBandit: snapshot.contextualBandit,
      status: snapshot.status,
      weightsWereUpdated: snapshot.weightsWereUpdated,
      contextualBanditEventId: snapshot.contextualBanditEventId,
      error: snapshot.error,
      dateCreated: snapshot.dateCreated.toISOString(),
    },
  };
});
