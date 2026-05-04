import { postExperimentSnapshotValidator } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { createExperimentSnapshot } from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { runContextualBanditSnapshot } from "back-end/src/jobs/runContextualBanditSnapshot";

// TODO update params (add phase, useCache)
export const postExperimentSnapshot = createApiRequestHandler(
  postExperimentSnapshotValidator,
)(async (req) => {
  const context = req.context;
  const id = req.params.id;

  const { triggeredBy, bandit } = req.body ?? {};
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

  // Contextual bandit experiments take a dedicated synchronous orchestrator.
  // The standard snapshot pipeline doesn't apply: there are no analyses,
  // no sticky bucketing, and the python "stats" call is the CB pipeline,
  // not the multi-experiment metric analysis.
  if (experiment.isContextualBandit) {
    const result = await runContextualBanditSnapshot({
      context,
      experiment,
      phaseIndex: experiment.phases.length - 1,
      opts: { reweight: !!bandit?.reweight },
    });
    return {
      snapshot: {
        // CBE id stands in as the snapshot identifier for CB experiments.
        id: result.event.id,
        experiment: experiment.id,
        status: "success" as const,
      },
    };
  }

  const createSnapshotPayload = {
    // use last phase by default
    phase: experiment.phases.length - 1,
    dimension: undefined,
    useCache: true,
  };

  const snapshot = await createExperimentSnapshot({
    context,
    experiment,
    datasource,
    triggeredBy,
    ...createSnapshotPayload,
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
      id: snapshot.snapshot.id,
      experiment: snapshot.snapshot.experiment,
      status: snapshot.snapshot.status,
    },
  };
});
