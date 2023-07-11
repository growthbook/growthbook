import { PostExperimentResponse } from "../../../types/openapi";
import {
  createExperiment,
  getExperimentByTrackingKey,
} from "../../models/ExperimentModel";
import { getDataSourceById } from "../../models/DataSourceModel";
import {
  postExperimentApiPayloadToExperimentInterface,
  toExperimentApiInterface,
} from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { postExperimentValidator } from "../../validators/openapi";

export const postExperiment = createApiRequestHandler(postExperimentValidator)(
  async (req): Promise<PostExperimentResponse> => {
    req.checkPermissions("createAnalyses", req.body.project);

    const { datasourceId } = req.body;

    const datasource = await getDataSourceById(
      datasourceId,
      req.organization.id
    );

    if (!datasource) {
      throw new Error(`Invalid data source: ${datasourceId}`);
    }

    // check for associated assignment query id
    if (
      !datasource.settings.queries?.exposure?.some(
        (q) => q.id === req.body.assignmentQueryId
      )
    ) {
      throw new Error(
        `Unrecognized assignment query ID: ${req.body.assignmentQueryId}`
      );
    }

    // check if tracking key is unique
    const existingByTrackingKey = await getExperimentByTrackingKey(
      req.organization.id,
      req.body.trackingKey
    );
    if (existingByTrackingKey) {
      throw new Error(
        `Experiment with tracking key already exists: ${req.body.trackingKey}`
      );
    }

    // transform into exp interface; set sane defaults
    const newExperiment = postExperimentApiPayloadToExperimentInterface(
      req.body,
      req.organization,
      datasource
    );

    const experiment = await createExperiment({
      data: newExperiment,
      organization: req.organization,
      user: req.eventAudit,
    });

    const apiExperiment = await toExperimentApiInterface(
      req.organization,
      experiment
    );
    return {
      experiment: apiExperiment,
    };
  }
);
