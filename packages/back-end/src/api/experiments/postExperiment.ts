import { getNewExperimentDatasourceDefaults } from "shared/util";
import { auditDetailsCreate } from "../../services/audit";
import { PostExperimentResponse } from "../../../types/openapi";
import {
  createExperiment,
  getExperimentByTrackingKey,
} from "../../models/ExperimentModel";
import {
  getDataSourceById,
  getDataSourcesByOrganization,
} from "../../models/DataSourceModel";
import {
  postExperimentApiPayloadToInterface,
  toExperimentApiInterface,
} from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { postExperimentValidator } from "../../validators/openapi";
import { getUserByEmail } from "../../models/UserModel";
import { upsertWatch } from "../../models/WatchModel";

export const postExperiment = createApiRequestHandler(postExperimentValidator)(
  async (req): Promise<PostExperimentResponse> => {
    if (!req.context.permissions.canCreateExperiment(req.body)) {
      req.context.permissions.throwPermissionError();
    }

    const { datasourceId, owner: ownerEmail, trackingKey, project } = req.body;

    let { assignmentQueryId } = req.body;

    let datasource, defaultDatasource, defaultAssignmentQueryId;

    if (!req.organization.settings) {
      throw new Error("Organization settings not found");
    }

    if (!datasourceId || !assignmentQueryId) {
      const orgDatasources = await getDataSourcesByOrganization(req.context);
      const {
        datasource: defaultDatasourceId,
        exposureQueryId,
      } = getNewExperimentDatasourceDefaults(
        orgDatasources,
        req.organization.settings,
        project
      );
      defaultDatasource = orgDatasources.find(
        (d) => d.id === defaultDatasourceId
      );
      defaultAssignmentQueryId = exposureQueryId;
    }

    if (datasourceId) {
      datasource = await getDataSourceById(req.context, datasourceId);

      if (!datasource) {
        throw new Error(`Invalid data source: ${datasourceId}`);
      }
    } else {
      if (!defaultDatasource) {
        throw new Error(
          "Data source ID is not set and default data source not found"
        );
      }

      datasource = defaultDatasource;
    }

    if (assignmentQueryId) {
      if (
        !datasource.settings.queries?.exposure?.some(
          (q) => q.id === assignmentQueryId
        )
      ) {
        throw new Error(
          `Unrecognized assignment query ID: ${req.body.assignmentQueryId}`
        );
      }
    } else {
      if (!defaultAssignmentQueryId) {
        throw new Error(
          "Assignment query ID is not set and default assignment query ID not found"
        );
      }
      assignmentQueryId = defaultAssignmentQueryId;
    } // check for associated assignment query id
    // check if tracking key is unique
    if (trackingKey) {
      const existingByTrackingKey = await getExperimentByTrackingKey(
        req.context,
        trackingKey
      );
      if (existingByTrackingKey) {
        throw new Error(
          `Experiment with tracking key already exists: ${trackingKey}`
        );
      }
    }

    const ownerId = await (async () => {
      if (!ownerEmail) return req.context.userId;

      const user = await getUserByEmail(ownerEmail);

      // check if the user is a member of the organization
      const isMember = req.organization.members.some(
        (member) => member.id === user?.id
      );

      if (!isMember || !user) {
        throw new Error(`Unable to find user: ${ownerEmail}.`);
      }

      return user.id;
    })();

    // transform into exp interface; set sane defaults
    const newExperiment = postExperimentApiPayloadToInterface(
      {
        ...req.body,
        assignmentQueryId,
        ...(ownerId ? { owner: ownerId } : {}),
      },
      req.organization,
      datasource
    );

    const experiment = await createExperiment({
      data: newExperiment,
      context: req.context,
    });

    await req.audit({
      event: "experiment.create",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate(experiment),
    });

    if (ownerId) {
      // add owner as watcher
      await upsertWatch({
        userId: ownerId,
        organization: req.organization.id,
        item: experiment.id,
        type: "experiments",
      });
    }

    const apiExperiment = await toExperimentApiInterface(
      req.context,
      experiment
    );
    return {
      experiment: apiExperiment,
    };
  }
);
