import { GetResultsExperimentsResponse } from "back-end/types/openapi";
import { getExperimentsUpdatedBetween } from "back-end/src/models/ExperimentModel";
import { getLatestSnapshotMultipleExperiments } from "back-end/src/models/ExperimentSnapshotModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getResultsExperimentsValidator } from "back-end/src/validators/openapi";
import {
  ExperimentResultRow,
  getExperimentResultRows,
} from "back-end/src/services/experimentResults";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { ExperimentInterface } from "back-end/src/validators/experiments";

export const getResultsExperiments = createApiRequestHandler(
  getResultsExperimentsValidator
)(
  async (req): Promise<GetResultsExperimentsResponse> => {
    // Get all running experiments that had a snapshot attempt
    // between startDate and endDate
    const startDate = new Date(req.query.startDate);
    let endDate: Date | undefined = undefined;
    if (req.query.endDate) {
      endDate = new Date(req.query.endDate);
      if (!endDate) {
        throw new Error("Invalid endDate");
      }
    }
    const experiments = await getExperimentsUpdatedBetween(
      req.context,
      startDate,
      endDate
    );

    // Create a map of experiment ID to latest phase
    const experimentMap = new Map<string, ExperimentInterface>();
    const experimentPhaseMap = new Map<string, number>();
    for (const experiment of experiments) {
      experimentMap.set(experiment.id, experiment);
      experimentPhaseMap.set(experiment.id, experiment.phases.length - 1);
    }

    const snapshots = await getLatestSnapshotMultipleExperiments(
      experimentPhaseMap,
      undefined,
      true
    );
    const metricMap = await getMetricMap(req.context);

    const rows: ExperimentResultRow[] = [];
    for (const snapshot of snapshots) {
      const experiment = experimentMap.get(snapshot.experiment);
      if (!experiment) continue;
      rows.push(
        ...(await getExperimentResultRows({
          experiment,
          snapshot,
          metricMap,
        }))
      );
    }

    // TODO return any metadata about missing experiments/snapshtos?
    // TODO pagination
    return {
      result: rows,
    };
  }
);
