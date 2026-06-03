import { getCbSnapshotValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadCbForRead } from "./_shared";

export const getCbSnapshot = createApiRequestHandler(getCbSnapshotValidator)(
  async (req) => {
    const { experiment } = await loadCbForRead(req.context, req.params.id);
    const snapshot =
      await req.context.models.contextualBanditSnapshots.getBySnapshotIdInOrg(
        req.params.snapshotId,
      );
    // Guard against cross-CB snapshot access: a customer with read
    // access to CB-A shouldn't fetch a snapshot belonging to CB-B by
    // guessing the snapshot id.
    if (!snapshot || !experiment || snapshot.experiment !== experiment.id) {
      return req.context.throwNotFoundError();
    }
    return {
      snapshot: {
        id: snapshot.id,
        experiment: snapshot.experiment,
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
