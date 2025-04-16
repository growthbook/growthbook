import { GetSafeRolloutSnapshotResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getSafeRolloutSnapshotValidator } from "back-end/src/validators/openapi";

export const getSafeRolloutSnapshot = createApiRequestHandler(
  getSafeRolloutSnapshotValidator
)(
  async (req): Promise<GetSafeRolloutSnapshotResponse> => {
    const snapshot = await req.context.models.safeRolloutSnapshots.getById(req.params.id);
    if (!snapshot) {
      throw new Error("Snapshot not found or no permission to access");
    }
    
    // TODO is above permission check sufficient?
    return {
      safeRolloutSnapshot: {
        id: snapshot.id,
        safeRolloutId: snapshot.safeRolloutId,
        status: snapshot.status,
      },
    };
  }
);
