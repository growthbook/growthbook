import { listExperimentResultsValidator } from "shared/validators";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { getLatestSnapshotMultipleExperiments } from "back-end/src/models/ExperimentSnapshotModel";
import { toSnapshotApiInterface } from "back-end/src/services/experiments";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listExperimentResults = createApiRequestHandler(
  listExperimentResultsValidator,
)(async (req) => {
  const experiments = await getAllExperiments(req.context, {
    includeArchived: true,
    project: req.query.projectId,
    datasourceId: req.query.datasourceId,
    status: req.query.status,
    sortBy: { dateCreated: 1 },
  });

  const { filtered, returnFields } = applyPagination(experiments, req.query);

  // Build a single batched query for all experiments on this page that have at
  // least one phase. `getLatestSnapshotMultipleExperiments` does one Mongo
  // aggregation across the lot, so we avoid the 1+N pattern.
  const experimentPhaseMap = new Map<string, number>();
  for (const experiment of filtered) {
    if (experiment.phases.length > 0) {
      experimentPhaseMap.set(experiment.id, experiment.phases.length - 1);
    }
  }

  const snapshots = experimentPhaseMap.size
    ? await getLatestSnapshotMultipleExperiments(
        req.context,
        experimentPhaseMap,
      )
    : [];

  const snapshotsByExperiment = new Map(
    snapshots.map((snapshot) => [snapshot.experiment, snapshot]),
  );

  // Preserve the experiment ordering from getAllExperiments and drop
  // experiments without a completed snapshot. `count` is overridden below so it
  // reflects the response array, not the page slice.
  const experimentResults = filtered.flatMap((experiment) => {
    const snapshot = snapshotsByExperiment.get(experiment.id);
    return snapshot ? [toSnapshotApiInterface(experiment, snapshot)] : [];
  });

  return {
    experimentResults,
    ...returnFields,
    count: experimentResults.length,
  };
});
