import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { listExperimentResultsValidator } from "shared/validators";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { getLatestSnapshotMultipleExperiments } from "back-end/src/models/ExperimentSnapshotModel";
import {
  getExperimentMetricsByIds,
  toSnapshotApiInterface,
} from "back-end/src/services/experiments";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listExperimentResults = createApiRequestHandler(
  listExperimentResultsValidator,
)(async (req) => {
  // Filter and sort at the database level for better performance
  const experiments = await getAllExperiments(req.context, {
    includeArchived: true,
    project: req.query.projectId,
    datasourceId: req.query.datasourceId,
    trackingKey: req.query.trackingKey,
    status: req.query.status,
    sortBy: { dateCreated: 1 },
  });

  // TODO: Move pagination (limit/offset) to database for better performance
  const { filtered, returnFields } = applyPagination(experiments, req.query);

  // Build one batched lookup for the page. `getLatestSnapshotMultipleExperiments`
  // runs a single Mongo aggregation, so we avoid an N+1 over experiments.
  const experimentPhaseMap = new Map<string, number>();
  for (const experiment of filtered) {
    if (experiment.phases.length > 0) {
      const latestPhaseIndex = experiment.phases.length - 1;
      experimentPhaseMap.set(experiment.id, latestPhaseIndex);
    }
  }

  // Union of every metric id referenced across the filtered experiments, so we
  // can resolve display names with a single DB lookup.
  const metricGroups = await req.context.models.metricGroups.getAll();
  const allMetricIds = new Set<string>();
  for (const experiment of filtered) {
    for (const id of getAllMetricIdsFromExperiment(
      experiment,
      true,
      metricGroups,
    )) {
      allMetricIds.add(id);
    }
  }

  const [snapshots, metrics] = await Promise.all([
    getLatestSnapshotMultipleExperiments(req.context, experimentPhaseMap),
    getExperimentMetricsByIds(req.context, Array.from(allMetricIds)),
  ]);

  const metricsById = new Map(metrics.map((m) => [m.id, m]));

  const snapshotsByExperiment = new Map(
    snapshots.map((snapshot) => [snapshot.experiment, snapshot]),
  );

  // Preserve the experiment ordering from getAllExperiments and drop
  // experiments without a completed snapshot. `count` is overridden below so it
  // reflects the response array, not the page slice.
  const experimentResults = filtered.flatMap((experiment) => {
    const snapshot = snapshotsByExperiment.get(experiment.id);
    return snapshot
      ? [toSnapshotApiInterface(experiment, snapshot, metricsById)]
      : [];
  });

  return {
    experimentResults,
    ...returnFields,
    count: experimentResults.length,
  };
});
