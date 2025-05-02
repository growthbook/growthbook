import { GetResultsExperimentResponse } from "back-end/types/openapi";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getResultsExperimentValidator } from "back-end/src/validators/openapi";
import { getExperimentResultRows } from "back-end/src/services/experimentResults";
import { getMetricMap } from "back-end/src/models/MetricModel";

export const getResultsExperiment = createApiRequestHandler(
  getResultsExperimentValidator
)(
  async (req): Promise<GetResultsExperimentResponse> => {
    const experiment = await getExperimentById(req.context, req.params.id);
    if (!experiment) {
      throw new Error("Could not find experiment with that id");
    }

    const phase = parseInt(
      req.query.phase ?? experiment.phases.length - 1 + ""
    );

    const snapshot = await getLatestSnapshot({
      experiment: experiment.id,
      phase,
      dimension: req.query.dimension,
      withResults: true,
    });

    if (!snapshot) {
      throw new Error("No results found for that experiment");
    }

    const metricMap = await getMetricMap(req.context);
    const rows = await getExperimentResultRows({
      experiment,
      snapshot,
      metricMap,
      dimension: req.query.dimension,
    });

    return {
      result: rows,
    };
  }
);
