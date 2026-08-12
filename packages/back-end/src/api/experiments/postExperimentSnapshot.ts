import { postExperimentSnapshotValidator } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { createExperimentSnapshot } from "back-end/src/services/experiments";
import { validateSnapshotDimension } from "back-end/src/services/snapshotDimension";
import { ExperimentIncrementalPipelineRequiresFullRefreshError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";

export const postExperimentSnapshot = createApiRequestHandler(
  postExperimentSnapshotValidator,
)(async (req) => {
  const context = req.context;
  const id = req.params.id;

  const { triggeredBy, dimension, phase } = req.body ?? {};
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
  }

  const createSnapshot = (useCache: boolean) =>
    createExperimentSnapshot({
      context,
      experiment,
      datasource,
      triggeredBy,
      phase: phaseIndex,
      dimension,
      useCache,
    });

  // A programmatic refresh is non-interactive. When the Incremental Pipeline
  // requires a Full Refresh we run one transparently instead of surfacing an
  // error the caller would have to act on. Lesser incremental shortfalls fall
  // back to the non-incremental results runner during planning.
  let useCache = true;
  let result: Awaited<ReturnType<typeof createSnapshot>>;
  try {
    result = await createSnapshot(useCache);
  } catch (error) {
    if (
      !(error instanceof ExperimentIncrementalPipelineRequiresFullRefreshError)
    ) {
      throw error;
    }
    logger.info(
      `Experiment ${experiment.id}: ${error.details.reason} Running a Full Refresh automatically.`,
    );
    useCache = false;
    result = await createSnapshot(useCache);
  }
  const { snapshot } = result;

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
