import {
  postExperimentApiPayloadToInterface,
  toExperimentApiInterface,
} from "@back-end/src/services/experiments";
import { postExperimentValidator } from "@back-end/src/validators/openapi";
import { PostExperimentResponse } from "@back-end/types/openapi";
import {
  createExperiment,
  getExperimentByTrackingKey,
} from "@back-end/src/models/ExperimentModel";
import { getDataSourceById } from "@back-end/src/models/DataSourceModel";
import { upsertWatch } from "@back-end/src/models/WatchModel";
import { getUserByEmail } from "@back-end/src/services/users";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const postExperiment = createApiRequestHandler(postExperimentValidator)(
  async (req): Promise<PostExperimentResponse> => {
    req.checkPermissions("createAnalyses", req.body.project);

    const { datasourceId, owner: ownerEmail } = req.body;

    const datasource = await getDataSourceById(req.context, datasourceId);

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
      req.context,
      req.body.trackingKey
    );
    if (existingByTrackingKey) {
      throw new Error(
        `Experiment with tracking key already exists: ${req.body.trackingKey}`
      );
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
      { ...req.body, ...(ownerId ? { owner: ownerId } : {}) },
      req.organization,
      datasource
    );

    const experiment = await createExperiment({
      data: newExperiment,
      context: req.context,
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
