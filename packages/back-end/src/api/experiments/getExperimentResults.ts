import { getExperimentResultsValidator } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestDimensionResult } from "back-end/src/models/ExperimentSnapshotModel";
import { toSnapshotApiInterface } from "back-end/src/services/experiments";
import { validateSnapshotDimension } from "back-end/src/services/snapshotDimension";
import { createApiRequestHandler } from "back-end/src/util/handler";

function getPhaseIndex(phase: string | undefined, phaseCount: number): number {
  if (!phaseCount) {
    throw new Error("Experiment has no phases");
  }

  if (phase === undefined) {
    return phaseCount - 1;
  }

  if (!/^\d+$/.test(phase)) {
    throw new Error("Phase must be a non-negative integer");
  }

  const phaseIndex = Number(phase);
  if (!Number.isSafeInteger(phaseIndex)) {
    throw new Error("Phase must be a non-negative integer");
  }
  if (phaseIndex >= phaseCount) {
    throw new Error(`Phase ${phaseIndex} not found`);
  }

  return phaseIndex;
}

export const getExperimentResults = createApiRequestHandler(
  getExperimentResultsValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }

  const phase = getPhaseIndex(req.query.phase, experiment.phases.length);
  const dimension = req.query.dimension;

  if (dimension) {
    if (!experiment.datasource) {
      throw new Error("No datasource set for experiment");
    }

    const datasource = await getDataSourceById(
      req.context,
      experiment.datasource,
    );
    if (!datasource) {
      req.context.logger?.warn(
        {
          datasourceId: experiment.datasource,
          experimentId: experiment.id,
        },
        "Could not find datasource for experiment results request",
      );
      throw new Error("Could not find the experiment's datasource");
    }

    await validateSnapshotDimension({
      experiment,
      datasource,
      dimension,
      logger: req.context.logger,
      organization: req.context.org.id,
    });
  }

  const dimensionResult = await getLatestDimensionResult({
    context: req.context,
    experiment: experiment.id,
    phase,
    dimension,
  });

  if (!dimensionResult) {
    throw new Error("No results found for that experiment");
  }

  return {
    result: toSnapshotApiInterface(experiment, dimensionResult.snapshot, {
      analysis: dimensionResult.analysis,
      dimension: dimensionResult.dimension,
      source: dimensionResult.source,
    }),
  };
});
