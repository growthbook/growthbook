import { getAllMetricIdsFromExperiment } from "shared/experiments";
import {
  ExperimentInterfaceExcludingHoldouts,
  Variation,
  updateExperimentValidator,
} from "shared/validators";
import { UpdateExperimentResponse } from "shared/types/openapi";
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
import { shouldValidateCustomFieldsOnUpdate } from "back-end/src/util/custom-fields";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { validateVariationIds } from "back-end/src/controllers/experiments";
import { validateCustomFields } from "./validations";

export const updateExperiment = createApiRequestHandler(
  updateExperimentValidator,
)(async (req): Promise<UpdateExperimentResponse> => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find the experiment to update");
  }
  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported via this API");
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
        "Cannot change datasource via API if one is already set.",
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
        (q) => q.id === req.body.assignmentQueryId,
      )
    ) {
      throw new Error(
        `Unrecognized assignment query ID: ${req.body.assignmentQueryId}`,
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
      req.body.trackingKey,
    );
    if (existingByTrackingKey) {
      throw new Error(
        `Experiment with tracking key already exists: ${req.body.trackingKey}`,
      );
    }
  }

  const projectChanged =
    req.body.project !== undefined && req.body.project !== experiment.project;
  const customFieldsChanged = shouldValidateCustomFieldsOnUpdate({
    existingCustomFieldValues: experiment.customFields,
    updatedCustomFieldValues: req.body.customFields,
  });

  if (projectChanged || customFieldsChanged) {
    await validateCustomFields(
      req.body.customFields ?? experiment.customFields,
      req.context,
      req.body.project ?? experiment.project,
    );
  }

  // Validate that specified metrics exist and belong to the organization
  const metricGroups = await req.context.models.metricGroups.getAll();
  const oldMetricIds = getAllMetricIdsFromExperiment(
    experiment,
    true,
    metricGroups,
  );
  const newMetricIds = getAllMetricIdsFromExperiment(
    {
      goalMetrics: req.body.metrics,
      secondaryMetrics: req.body.secondaryMetrics,
      guardrailMetrics: req.body.guardrailMetrics,
      activationMetric: req.body.activationMetric,
    },
    true,
    metricGroups,
  ).filter((m) => !oldMetricIds.includes(m));

  const map = await getMetricMap(req.context);

  if (newMetricIds.length) {
    if (!datasource) {
      throw new Error("Must provide a datasource when including metrics");
    }
    for (let i = 0; i < newMetricIds.length; i++) {
      const metric = map.get(newMetricIds[i]);
      if (metric) {
        // Make sure it is tied to the same datasource as the experiment
        if (datasource.id && metric.datasource !== datasource.id) {
          throw new Error(
            "Metrics must be tied to the same datasource as the experiment: " +
              newMetricIds[i],
          );
        }
      } else {
        // check to see if this metric is actually a metric group
        const metricGroup = await req.context.models.metricGroups.getById(
          newMetricIds[i],
        );
        if (metricGroup) {
          // Make sure it is tied to the same datasource as the experiment
          if (datasource.id && metricGroup.datasource !== datasource.id) {
            throw new Error(
              "Metrics must be tied to the same datasource as the experiment: " +
                newMetricIds[i],
            );
          }
        } else {
          // new metric that's not recognized...
          throw new Error("Unknown metric: " + newMetricIds[i]);
        }
      }
    }
  }

  if (req.body.variations) {
    validateVariationIds(req.body.variations as Variation[]);
  }

  if (
    req.body.type &&
    req.body.type !== (experiment.type || "standard") &&
    experiment.status !== "draft" &&
    req.body.status !== "draft"
  ) {
    throw new Error("Can only convert experiment types while in draft mode.");
  }

  const updatedExperiment = await updateExperimentToDb({
    context: req.context,
    experiment: experiment,
    changes: updateExperimentApiPayloadToInterface(
      req.body,
      experiment,
      map,
      req.organization,
    ),
  });

  if (updatedExperiment === null) {
    throw new Error("Error happened during updating experiment.");
  }
  const apiExperiment = await toExperimentApiInterface(
    req.context,
    updatedExperiment as ExperimentInterfaceExcludingHoldouts,
  );
  return {
    experiment: apiExperiment,
  };
});
