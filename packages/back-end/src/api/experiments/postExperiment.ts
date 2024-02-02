import { PostExperimentResponse } from "../../../types/openapi";
import {
  createExperiment,
  getExperimentByTrackingKey,
} from "../../models/ExperimentModel";
import { getDataSourceById } from "../../models/DataSourceModel";
import {
  postExperimentApiPayloadToInterface,
  toExperimentApiInterface,
} from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { postExperimentValidator } from "../../validators/openapi";
import { getUserByEmail } from "../../services/users";
import { upsertWatch } from "../../models/WatchModel";

export const postExperiment = createApiRequestHandler(postExperimentValidator)(
  async (req): Promise<PostExperimentResponse> => {
    req.checkPermissions("createAnalyses", req.body.project);

    const { datasourceId, owner } = req.body;

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

    const user = await getUserByEmail(owner);

    // check if the user is a member of the organization
    const isMember = req.organization.members.some(
      (member) => member.id === user?.id
    );

    if (!isMember || !user) {
      throw new Error(`Unable to find user: ${owner}.`);
    }

    // transform into exp interface; set sane defaults
    const newExperiment = postExperimentApiPayloadToInterface(
      { ...req.body, owner: user.id },
      req.organization,
      datasource
    );

    const experiment = await createExperiment({
      data: newExperiment,
      context: req.context,
      user: req.eventAudit,
    });

    // add owner as watcher
    await upsertWatch({
      userId: user.id,
      organization: req.organization.id,
      item: experiment.id,
      type: "experiments",
    });

    const apiExperiment = await toExperimentApiInterface(
      req.context,
      experiment
    );
    return {
      experiment: apiExperiment,
    };
  }
);
