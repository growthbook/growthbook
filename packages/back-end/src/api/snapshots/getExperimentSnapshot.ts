import { getExperimentSnapshotValidator } from "shared/validators";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { toApiExperimentSnapshot } from "./toApiExperimentSnapshot";

export const getExperimentSnapshot = createApiRequestHandler(
  getExperimentSnapshotValidator,
)(async (req) => {
  const snapshot = await findSnapshotById(req.context, req.params.id);
  if (!snapshot) {
    throw new NotFoundError("Snapshot not found or no permission to access");
  }
  // no permission check in above method, so have to make sure they can read
  // experiment first, which will be thrown by getExperimentById method
  const experiment = await getExperimentById(req.context, snapshot.experiment);
  if (!experiment) {
    throw new NotFoundError("Snapshot not found or no permission to access");
  }
  return { snapshot: toApiExperimentSnapshot(snapshot) };
});
