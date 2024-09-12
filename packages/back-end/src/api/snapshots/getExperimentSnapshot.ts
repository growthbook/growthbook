import { findSnapshotById } from "../../models/ExperimentSnapshotModel";
import { GetExperimentSnapshotResponse } from "../../../types/openapi";
import { getExperimentById } from "../../models/ExperimentModel";
import { createApiRequestHandler } from "../../util/handler";
import { getExperimentSnapshotValidator } from "../../validators/openapi";

export const getExperimentSnapshot = createApiRequestHandler(
  getExperimentSnapshotValidator
)(
  async (req): Promise<GetExperimentSnapshotResponse> => {
    const snapshot = await findSnapshotById(req.context.org.id, req.params.id);
    if (!snapshot) {
      throw new Error("Snapshot not found");
    }
    // no permission check in above method, so have to make sure they can read
    // experiment first, which will be thrown by getExperimentById method
    const experiment = await getExperimentById(
      req.context,
      snapshot.experiment
    );
    if (!experiment) {
      throw new Error("Experiment not found for that snapshot");
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
