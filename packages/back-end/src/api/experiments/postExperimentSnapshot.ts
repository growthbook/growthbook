import { postExperimentSnapshotValidator } from "shared/validators";
import { PostExperimentSnapshotResponse } from "shared/types/openapi";
import { SNAPSHOT_TIMEOUT } from "back-end/src/controllers/experiments";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import {
  requestExperimentSnapshot,
  waitForSnapshotExecution,
} from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";

// TODO update params (add phase, useCache)
export const postExperimentSnapshot = createApiRequestHandler(
  postExperimentSnapshotValidator,
)(async (req): Promise<PostExperimentSnapshotResponse> => {
  const context = req.context;
  const id = req.params.id;

  const { triggeredBy } = req.body;
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
      `Could not find datasource for this experiment (datasource id: ${experiment.datasource})`,
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
  };

  // Wait until the snapshot is in a final state, which can
  // take some time, so we use increased timeout.
  req.setTimeout(SNAPSHOT_TIMEOUT);

  const { snapshot } = await requestExperimentSnapshot({
    context,
    experiment,
    phaseIndex: createSnapshotPayload.phase,
    useCache: createSnapshotPayload.useCache,
    triggeredBy,
  });

  const finalSnapshot = await waitForSnapshotExecution({
    context,
    snapshotId: snapshot.id,
    timeoutMs: SNAPSHOT_TIMEOUT,
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
      id: finalSnapshot.id,
      experiment: finalSnapshot.experiment,
      status: finalSnapshot.status,
    },
  };
});
