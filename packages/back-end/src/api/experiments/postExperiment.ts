import { getAllMetricIdsFromExperiment } from "shared/experiments";
import {
  ExperimentInterfaceExcludingHoldouts,
  Variation,
  postExperimentValidator,
} from "shared/validators";
import { PostExperimentResponse } from "shared/types/openapi";
import {
  createExperiment,
  getExperimentByTrackingKey,
} from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  postExperimentApiPayloadToInterface,
  toExperimentApiInterface,
} from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getUserByEmail } from "back-end/src/models/UserModel";
import { upsertWatch } from "back-end/src/models/WatchModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { validateVariationIds } from "back-end/src/controllers/experiments";
import { validateCustomFields } from "./validation";

export const postExperiment = createApiRequestHandler(postExperimentValidator)(
  async (req): Promise<PostExperimentResponse> => {
    const { datasourceId, owner: ownerEmail, project, customFields } = req.body;

    // Validate projects - We can remove this validation when FeatureModel is migrated to BaseModel
    if (project) {
      await req.context.models.projects.ensureProjectsExist([project]);
    }

    if (!req.context.permissions.canCreateExperiment(req.body)) {
      req.context.permissions.throwPermissionError();
    }

    const datasource = datasourceId
      ? await getDataSourceById(req.context, datasourceId)
      : null;
    if (datasourceId && !datasource) {
      throw new Error(`Invalid data source: ${datasourceId}`);
    }

    // check for associated assignment query id
    if (
      datasource &&
      !datasource.settings.queries?.exposure?.some(
        (q) => q.id === req.body.assignmentQueryId,
      )
    ) {
      throw new Error(
        `Unrecognized assignment query ID: ${req.body.assignmentQueryId}`,
      );
    }

    // check if tracking key is unique
    const existingByTrackingKey = await getExperimentByTrackingKey(
      req.context,
      req.body.trackingKey,
    );
    if (existingByTrackingKey) {
      throw new Error(
        `Experiment with tracking key already exists: ${req.body.trackingKey}`,
      );
    }

    // check if the custom fields are valid
    if (customFields) {
      await validateCustomFields(customFields, req.context, project);
    }

    const ownerId = await (async () => {
      if (!ownerEmail) return req.context.userId;
      const user = await getUserByEmail(ownerEmail);
      // check if the user is a member of the organization
      const isMember = req.organization.members.some(
        (member) => member.id === user?.id,
      );
      if (!isMember || !user) {
        throw new Error(`Unable to find user: ${ownerEmail}.`);
      }
      return user.id;
    })();

    // Validate that specified metrics exist and belong to the organization
    const metricGroups = await req.context.models.metricGroups.getAll();
    const metricIds = getAllMetricIdsFromExperiment(
      {
        goalMetrics: req.body.metrics,
        secondaryMetrics: req.body.secondaryMetrics,
        guardrailMetrics: req.body.guardrailMetrics,
        activationMetric: req.body.activationMetric,
      },
      true,
      metricGroups,
    );
    if (metricIds.length) {
      if (!datasource) {
        throw new Error("Must provide a datasource when including metrics");
      }
      const map = await getMetricMap(req.context);
      for (let i = 0; i < metricIds.length; i++) {
        const metric = map.get(metricIds[i]);
        if (metric) {
          // Make sure it is tied to the same datasource as the experiment
          if (datasource.id && metric.datasource !== datasource.id) {
            throw new Error(
              "Metrics must be tied to the same datasource as the experiment: " +
                metricIds[i],
            );
          }
        } else {
          // check to see if this metric is actually a metric group
          const metricGroup = await req.context.models.metricGroups.getById(
            metricIds[i],
          );
          if (metricGroup) {
            // Make sure it is tied to the same datasource as the experiment
            if (datasource.id && metricGroup.datasource !== datasource.id) {
              throw new Error(
                "Metrics must be tied to the same datasource as the experiment: " +
                  metricIds[i],
              );
            }
          } else {
            // new metric that's not recognized...
            throw new Error("Unknown metric: " + metricIds[i]);
          }
        }
      }
    }
    if (req.body.variations) {
      validateVariationIds(req.body.variations as Variation[]);
    }

    // transform into exp interface; set sane defaults
    const newExperiment = postExperimentApiPayloadToInterface(
      {
        ...req.body,
        ...(ownerId ? { owner: ownerId } : {}),
      },
      req.organization,
      datasource,
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
      experiment as ExperimentInterfaceExcludingHoldouts,
    );
    return {
      experiment: apiExperiment,
    };
  },
);
