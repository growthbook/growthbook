import {
  toExperimentApiInterface,
  updateExperimentApiPayloadToInterface,
} from "@back-end/src/services/experiments";
import { updateExperimentValidator } from "@back-end/src/validators/openapi";
import { UpdateExperimentResponse } from "@back-end/types/openapi";
import { getDataSourceById } from "@back-end/src/models/DataSourceModel";
import {
  updateExperiment as updateExperimentToDb,
  getExperimentById,
  getExperimentByTrackingKey,
} from "@back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const updateExperiment = createApiRequestHandler(
  updateExperimentValidator
)(
  async (req): Promise<UpdateExperimentResponse> => {
    const experiment = await getExperimentById(req.context, req.params.id);
    if (!experiment) {
      throw new Error("Could not find the experiment to update");
    }

    req.checkPermissions("createAnalyses", experiment.project);

    const datasource = await getDataSourceById(
      req.context,
      experiment.datasource
    );
    if (!datasource) {
      throw new Error("No datasource for this experiment was found.");
    }
    // check for associated assignment query id
    if (
      req.body.assignmentQueryId != null &&
      req.body.assignmentQueryId !== experiment.exposureQueryId &&
      !datasource.settings.queries?.exposure?.some(
        (q) => q.id === req.body.assignmentQueryId
      )
    ) {
      throw new Error(
        `Unrecognized assignment query ID: ${req.body.assignmentQueryId}`
      );
    }

    // check if tracking key is unique
    if (
      req.body.trackingKey != null &&
      req.body.trackingKey !== experiment.trackingKey
    ) {
      const existingByTrackingKey = await getExperimentByTrackingKey(
        req.context,
        req.body.trackingKey
      );
      if (existingByTrackingKey) {
        throw new Error(
          `Experiment with tracking key already exists: ${req.body.trackingKey}`
        );
      }
    }

    const updatedExperiment = await updateExperimentToDb({
      context: req.context,
      experiment: experiment,
      changes: updateExperimentApiPayloadToInterface(req.body, experiment),
    });

    if (updatedExperiment === null) {
      throw new Error("Error happened during updating experiment.");
    }
    const apiExperiment = await toExperimentApiInterface(
      req.context,
      updatedExperiment
    );
    return {
      experiment: apiExperiment,
    };
  }
);
