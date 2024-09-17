import { auditDetailsCreate } from "../../services/audit";
import { PostExperimentSnapshotResponse } from "../../../types/openapi";
import { getExperimentById } from "../../models/ExperimentModel";
import { getDataSourceById } from "../../models/DataSourceModel";
import { createApiRequestHandler } from "../../util/handler";
import { postExperimentSnapshotValidator } from "../../validators/openapi";
import { createExperimentSnapshot, SNAPSHOT_TIMEOUT } from "../../controllers/experiments";

// TODO update params (add phase, useCache)
export const postExperimentSnapshot = createApiRequestHandler(
  postExperimentSnapshotValidator
)(
  async (req): Promise<PostExperimentSnapshotResponse> => {
    const context = req.context;
    const id = req.params.id;

    const experiment = await getExperimentById(context, id);

    if (!experiment) {
      throw new Error("Experiment not found");
    }
    if (!experiment.datasource) {
      throw new Error("No datasource set for experiment");
    }

    const datasource = await getDataSourceById(context, experiment.datasource);
    if (!datasource) {
      throw new Error(
        `Could not find datasource for this experiment (datasource id: ${experiment.datasource})`
      );
    }

    if (!req.context.permissions.canCreateExperimentSnapshot(datasource)) {
      req.context.permissions.throwPermissionError();
    }
    // If this endpoint begins to allow new settings, `canCreateExperimentSnapshot`
    // should be updated to check if the user canUpdateExperiment.

    if (experiment.status === "draft") {
      throw new Error(`Experiment is in draft state.`);
    }

    if (!experiment.phases.length) {
      throw new Error(`Experiment has no phases`);
    }

    const createSnapshotPayload = {
      // use last phase by default
      phase: experiment.phases.length - 1,
      dimension: undefined,
      useCache: true,
    }

    // This is doing an expensive analytics SQL query, so may take a long time
    // Set timeout to 30 minutes
    req.setTimeout(SNAPSHOT_TIMEOUT);

    const snapshot = await createExperimentSnapshot({
      context,
      experiment,
      datasource,
      ...createSnapshotPayload
    });

    await req.audit({
      event: "experiment.refresh",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate({
        ...createSnapshotPayload,
        manual: false,
      }),
    });
    return {
      snapshot: {
        id: snapshot.id,
        experiment: snapshot.experiment,
        status: snapshot.status,
      },
    };
  }
);
