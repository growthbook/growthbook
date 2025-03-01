import { UpdateExperimentResponse } from "back-end/types/openapi";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  updateExperiment as updateExperimentToDb,
  getExperimentById,
  getExperimentByTrackingKey,
} from "back-end/src/models/ExperimentModel";
import {
  toExperimentApiInterface,
  updateExperimentApiPayloadToInterface,
} from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateExperimentValidator } from "back-end/src/validators/openapi";

export const updateExperiment = createApiRequestHandler(
  updateExperimentValidator
)(
  async (req): Promise<UpdateExperimentResponse> => {
    const experiment = await getExperimentById(req.context, req.params.id);
    if (!experiment) {
      throw new Error("Could not find the experiment to update");
    }

    // Validate projects - We can remove this validation when FeatureModel is migrated to BaseModel
    if (req.body.project) {
      await req.context.models.projects.ensureProjectsExist([req.body.project]);
    }

    if (!req.context.permissions.canUpdateExperiment(experiment, req.body)) {
      req.context.permissions.throwPermissionError();
    }

    // validate datasource only if updating
    const datasourceId = req.body.datasourceId ?? experiment.datasource;
    const datasource = datasourceId
      ? await getDataSourceById(req.context, datasourceId)
      : null;

    if (
      req.body.datasourceId !== undefined &&
      req.body.datasourceId !== experiment.datasource
    ) {
      if (experiment.datasource) {
        throw new Error(
          "Cannot change datasource via API if one is already set."
        );
      }
      if (!datasource) {
        throw new Error("Datasource not found.");
      }
    }

    // check for associated assignment query id
    if (
      req.body.assignmentQueryId !== undefined &&
      req.body.assignmentQueryId !== experiment.exposureQueryId
    ) {
      if (!datasource) {
        throw new Error("Datasource not found.");
      }
      if (
        !datasource.settings.queries?.exposure?.some(
          (q) => q.id === req.body.assignmentQueryId
        )
      ) {
        throw new Error(
          `Unrecognized assignment query ID: ${req.body.assignmentQueryId}`
        );
      }
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
