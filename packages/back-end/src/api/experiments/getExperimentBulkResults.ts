import { getExperimentBulkResultsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSnapshotsByExperiment } from "back-end/src/models/ExperimentSnapshotModel";
import {
  getMetricMapForExperiment,
  toExperimentSnapshotBulkResultsApiInterface,
} from "back-end/src/services/experiments";
import {
  createApiRequestHandler,
  getPaginationReturnFields,
  validatePagination,
} from "back-end/src/util/handler";

export const getExperimentBulkResults = createApiRequestHandler(
  getExperimentBulkResultsValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }

  const dateStart = new Date(req.query.dateStart);
  if (isNaN(dateStart.getTime())) {
    throw new Error("Invalid dateStart, expected an ISO 8601 date-time");
  }
  const dateEnd = req.query.dateEnd ? new Date(req.query.dateEnd) : new Date();
  if (isNaN(dateEnd.getTime())) {
    throw new Error("Invalid dateEnd, expected an ISO 8601 date-time");
  }

  const phase =
    req.query.phase !== undefined ? parseInt(req.query.phase, 10) : undefined;
  if (phase !== undefined && isNaN(phase)) {
    throw new Error("Invalid phase");
  }

  const { limit, offset } = validatePagination(req.query);

  const [{ snapshots, total }, metricsById] = await Promise.all([
    findSnapshotsByExperiment(req.context, {
      experiment: experiment.id,
      dateStart,
      dateEnd,
      phase,
      type: req.query.type,
      limit,
      offset,
    }),
    getMetricMapForExperiment(req.context, experiment),
  ]);

  // A single snapshot expands into one result item per dimension; pagination
  // stays over snapshots, so `count` reflects snapshots on this page.
  const results = snapshots.flatMap((snapshot) =>
    toExperimentSnapshotBulkResultsApiInterface(
      experiment,
      snapshot,
      metricsById,
    ),
  );

  return {
    results,
    ...getPaginationReturnFields(snapshots, total, { limit, offset }),
  };
});
