import { GetExperimentSnapshotResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getExperimentSnapshotValidator } from "back-end/src/validators/openapi";

export const getExperimentSnapshot = createApiRequestHandler(
  getExperimentSnapshotValidator
)(
  async (req): Promise<GetExperimentSnapshotResponse> => {
    const snapshot = await req.context.models.experimentSnapshots.getById(
      req.params.id
    );
    if (!snapshot) {
      throw new Error("Snapshot not found or no permission to access");
    }
    return {
      snapshot: {
        id: snapshot.id,
        experiment: snapshot.experiment,
        status: snapshot.status,
      },
    };
  }
);
