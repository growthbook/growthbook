import { auditDetailsUpdate } from "../../services/audit";
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
    const experiment = await getExperimentById(req.context, req.params.id);
    if (!experiment) {
      throw new Error("Could not find the experiment to update");
    }

    if (!req.context.permissions.canUpdateExperiment(experiment, req.body)) {
      req.context.permissions.throwPermissionError();
    }

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

    let archivedEvent:
      | "experiment.archive"
      | "experiment.unarchive"
      | undefined = undefined;
    if (!experiment.archived && updatedExperiment.archived) {
      archivedEvent = "experiment.archive";
    } else if (experiment.archived && !updatedExperiment.archived) {
      archivedEvent = "experiment.unarchive";
    }

    const auditDetails: string = auditDetailsUpdate(
      experiment,
      updatedExperiment,
      {}
    );

    if (archivedEvent !== undefined) {
      await req.audit({
        event: archivedEvent,
        entity: {
          object: "experiment",
          id: experiment.id,
        },
        details: auditDetails,
      });
    }

    // would be great to only emit this when something other then archived status changes
    await req.audit({
      event: "experiment.update",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetails,
    });

    const apiExperiment = await toExperimentApiInterface(
      req.context,
      updatedExperiment
    );
    return {
      experiment: apiExperiment,
    };
  }
);
