import { getCbSnapshotValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadCbForRead } from "./_shared";

export const getCbSnapshot = createApiRequestHandler(getCbSnapshotValidator)(
  async (req) => {
    const { cb } = await loadCbForRead(req.context, req.params.id);
    const snapshot =
      await req.context.models.contextualBanditSnapshots.getBySnapshotIdInOrg(
        req.params.snapshotId,
      );
    // Guard against cross-CB access: read on CB-A must not leak CB-B snapshots.
    if (!snapshot || snapshot.contextualBandit !== cb.id) {
      return req.context.throwNotFoundError();
    }
    return {
      snapshot: {
        id: snapshot.id,
        contextualBandit: snapshot.contextualBandit,
        phase: snapshot.phase,
        status: snapshot.status,
        weightsWereUpdated: snapshot.weightsWereUpdated,
        contextualBanditEventId: snapshot.contextualBanditEventId,
        error: snapshot.error,
        dateCreated: snapshot.dateCreated.toISOString(),
      },
    };
  },
);
