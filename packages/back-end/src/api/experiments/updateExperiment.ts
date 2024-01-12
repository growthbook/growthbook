import { UpdateExperimentResponse } from "../../../types/openapi";
import { getDataSourceById } from "../../models/DataSourceModel";
import {
  updateExperiment as updateExperimentToDb,
  getExperimentById,
  getExperimentByTrackingKey,
} from "../../models/ExperimentModel";
import {
  toExperimentApiInterface,
  updateExperimentApiPayloadToInterface,
} from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { updateExperimentValidator } from "../../validators/openapi";

export const updateExperiment = createApiRequestHandler(
  updateExperimentValidator
)(
  async (req): Promise<UpdateExperimentResponse> => {
    const experiment = await getExperimentById(
      req.organization.id,
      req.params.id
    );
    if (!experiment) {
      throw new Error("Could not find the experiment to update");
    }

    req.checkPermissions("createAnalyses", experiment.project);

    const datasource = await getDataSourceById(
      experiment.datasource,
      req.organization.id
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
        req.organization.id,
        req.body.trackingKey
      );
      if (existingByTrackingKey) {
        throw new Error(
          `Experiment with tracking key already exists: ${req.body.trackingKey}`
        );
      }
    }

    const updatedExperiment = await updateExperimentToDb({
      organization: req.organization,
      experiment: experiment,
      user: req.eventAudit,
      readAccessFilter: req.readAccessFilter,
      changes: updateExperimentApiPayloadToInterface(req.body, experiment),
    });

    if (updatedExperiment === null) {
      throw new Error("Error happened during updating experiment.");
    }
    const apiExperiment = await toExperimentApiInterface(
      req.organization,
      updatedExperiment,
      req.readAccessFilter
    );
    return {
      experiment: apiExperiment,
    };
  }
);
