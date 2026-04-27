import { getAllMetricIdsFromExperiment } from "shared/experiments";
import {
  ExperimentInterfaceExcludingHoldouts,
  ExperimentTemplateInterface,
  Variation,
  postExperimentValidator,
} from "shared/validators";
import { omit } from "lodash";
import {
  createExperiment,
  getExperimentByTrackingKey,
} from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  postExperimentApiPayloadToInterface,
  toExperimentApiInterface,
  validateVariationIds,
} from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  resolveOwnerToUserId,
  resolveOwnerEmail,
} from "back-end/src/services/owner";
import { getMetricMap } from "back-end/src/models/MetricModel";
import {
  assertExperimentPayloadCommercialFeatures,
  validateCustomFields,
} from "./validations";

const TEMPLATE_FIELDS_TO_OMIT = [
  "id",
  "organization",
  "owner",
  "dateCreated",
  "dateUpdated",
  "templateMetadata",
];

const TEMPLATE_FIELDS_TO_TRANSLATE = [
  "targeting",
  "datasource",
  "exposureQueryId",
  "goalMetrics",
  "segment",
  "skipPartialData",
];

function templateToPostExperimentDefaults(
  template: ExperimentTemplateInterface,
) {
  const templateWithoutFieldsToTranslate = omit(template, [
    ...TEMPLATE_FIELDS_TO_OMIT,
    ...TEMPLATE_FIELDS_TO_TRANSLATE,
  ]);

  return {
    ...templateWithoutFieldsToTranslate,
    datasourceId: template.datasource || undefined,
    assignmentQueryId: template.exposureQueryId || undefined,
    metrics: template.goalMetrics,
    segmentId: template.segment,
    inProgressConversions:
      template.skipPartialData === undefined
        ? undefined
        : template.skipPartialData
          ? ("strict" as const)
          : ("loose" as const),
    phases: [
      {
        name: "Main",
        dateStarted: new Date().toISOString(),
        coverage: template.targeting.coverage,
        condition: template.targeting.condition,
        prerequisites: template.targeting.prerequisites,
        savedGroupTargeting: template.targeting.savedGroups?.map((s) => ({
          matchType: s.match,
          savedGroups: s.ids,
        })),
      },
    ],
  };
}

export const postExperiment = createApiRequestHandler(postExperimentValidator)(
  async (req) => {
    const { owner: ownerEmail, templateId } = req.body;
    let payload = req.body;

    // Apply template defaults if a templateId is provided
    if (templateId) {
      const template =
        await req.context.models.experimentTemplates.getById(templateId);
      if (!template) {
        throw new Error(`Invalid template: ${templateId}`);
      }

      if (req.body.datasourceId !== undefined) {
        throw new Error(
          "datasourceId cannot be set when templateId is provided",
        );
      }

      if (req.body.assignmentQueryId !== undefined) {
        throw new Error(
          "assignmentQueryId cannot be set when templateId is provided",
        );
      }

      payload = {
        ...templateToPostExperimentDefaults(template),
        ...req.body,
      };
    }

    if (payload.assignmentQueryId === undefined) {
      throw new Error(
        "assignmentQueryId is required unless provided by the template",
      );
    }

    // Validate projects - We can remove this validation when ExperimentModel is migrated to BaseModel
    if (payload.project) {
      await req.context.models.projects.ensureProjectsExist([payload.project]);
    }

    if (!req.context.permissions.canCreateExperiment(payload)) {
      req.context.permissions.throwPermissionError();
    }

    assertExperimentPayloadCommercialFeatures(req.context, {
      postStratificationEnabled: payload.postStratificationEnabled,
      decisionFrameworkSettings: payload.decisionFrameworkSettings,
      metricOverrides: payload.metricOverrides,
      defaultDashboardId: payload.defaultDashboardId,
    });

    const datasource = payload.datasourceId
      ? await getDataSourceById(req.context, payload.datasourceId)
      : null;
    if (payload.datasourceId && !datasource) {
      throw new Error(`Invalid data source: ${payload.datasourceId}`);
    }

    // check for associated assignment query id
    if (
      datasource &&
      !datasource.settings.queries?.exposure?.some(
        (q) => q.id === payload.assignmentQueryId,
      )
    ) {
      throw new Error(
        `Unrecognized assignment query ID: ${payload.assignmentQueryId}`,
      );
    }

    // check if tracking key is unique
    if (!payload.bypassDuplicateKeyCheck) {
      const existingByTrackingKey = await getExperimentByTrackingKey(
        req.context,
        payload.trackingKey,
      );
      if (existingByTrackingKey) {
        throw new Error(
          `Experiment with tracking key already exists: ${payload.trackingKey}`,
        );
      }
    }

    await validateCustomFields(
      payload.customFields,
      req.context,
      payload.project,
    );

    if (payload.defaultDashboardId) {
      const dashboard = await req.context.models.dashboards.getById(
        payload.defaultDashboardId,
      );
      if (!dashboard) {
        throw new Error(`Invalid dashboard: ${payload.defaultDashboardId}`);
      }
    }
    const ownerId =
      (await resolveOwnerToUserId(ownerEmail, req.context, { strict: true })) ??
      req.context.userId;

    // Validate that specified metrics exist and belong to the organization
    const metricGroups = await req.context.models.metricGroups.getAll();
    const metricIds = getAllMetricIdsFromExperiment(
      {
        goalMetrics: payload.metrics,
        secondaryMetrics: payload.secondaryMetrics,
        guardrailMetrics: payload.guardrailMetrics,
        activationMetric: payload.activationMetric,
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
    if (payload.variations) {
      validateVariationIds(payload.variations as Variation[]);
    }

    // Validate attributionModel + lookbackOverride consistency
    if (
      payload.attributionModel === "lookbackOverride" &&
      !payload.lookbackOverride
    ) {
      throw new Error(
        "lookbackOverride is required when attributionModel is 'lookbackOverride'",
      );
    }

    // If lookbackOverride is provided in the payload, it must have the right
    // attribution model
    if (
      (payload.attributionModel ?? "firstExposure") !== "lookbackOverride" &&
      payload.lookbackOverride !== undefined
    ) {
      throw new Error(
        "lookbackOverride is only allowed when attributionModel is 'lookbackOverride'",
      );
    }

    // transform into exp interface; set sane defaults
    const newExperiment = postExperimentApiPayloadToInterface(
      {
        ...payload,
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
      await req.context.models.watch.upsertWatch({
        userId: ownerId,
        item: experiment.id,
        type: "experiments",
      });
    }

    const apiExperiment = await resolveOwnerEmail(
      await toExperimentApiInterface(
        req.context,
        experiment as ExperimentInterfaceExcludingHoldouts,
      ),
      req.context,
    );
    return {
      experiment: apiExperiment,
    };
  },
);
