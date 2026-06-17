import { postExperimentSnapshotValidator } from "shared/validators";
import { isExperimentIncrementalEnabled } from "shared/enterprise";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { createExperimentSnapshot } from "back-end/src/services/experiments";
import { validateSnapshotDimension } from "back-end/src/services/snapshotDimension";
import { BadRequestError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postExperimentSnapshot = createApiRequestHandler(
  postExperimentSnapshotValidator,
)(async (req) => {
  const context = req.context;
  const id = req.params.id;

  const { triggeredBy, dimension, phase, force } = req.body ?? {};
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

  const phaseIndex = phase ?? experiment.phases.length - 1;
  if (!experiment.phases[phaseIndex]) {
    throw new Error(`Phase ${phaseIndex} not found`);
  }

  if (dimension) {
    await validateSnapshotDimension({
      experiment,
      datasource,
      dimension,
      organization: context.org.id,
    });

    if (
      force &&
      isExperimentIncrementalEnabled(
        datasource.settings.pipelineSettings,
        experiment.id,
        experiment.type,
      )
    ) {
      throw new BadRequestError(
        'The "force" parameter cannot be used on Dimension snapshots when Incremental Pipeline mode is enabled. You can re-issue this request with dimension: "" to force a Full Refresh on Overall Results.',
      );
    }
  }

  const useCache = !force;

  const { snapshot } = await createExperimentSnapshot({
    context,
    experiment,
    datasource,
    triggeredBy,
    phase: phaseIndex,
    dimension,
    useCache,
  });

  await req.audit({
    event: "experiment.refresh",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsCreate({
      phase: phaseIndex,
      dimension,
      useCache,
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
});
