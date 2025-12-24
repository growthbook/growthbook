import { GetExperimentSnapshotResponse } from "shared/types/openapi";
import { getExperimentSnapshotValidator } from "shared/validators";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getExperimentSnapshot = createApiRequestHandler(
  getExperimentSnapshotValidator,
)(async (req): Promise<GetExperimentSnapshotResponse> => {
  const snapshot = await findSnapshotById(req.context.org.id, req.params.id);
  if (!snapshot) {
    throw new Error("Snapshot not found or no permission to access");
  }
  // no permission check in above method, so have to make sure they can read
  // experiment first, which will be thrown by getExperimentById method
  const experiment = await getExperimentById(req.context, snapshot.experiment);
  if (!experiment) {
    throw new Error("Snapshot not found or no permission to access");
  }
  return {
    snapshot: {
      id: snapshot.id,
      experiment: snapshot.experiment,
      status: snapshot.status,
    },
  };
});
