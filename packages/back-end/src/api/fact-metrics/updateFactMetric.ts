import z from "zod";
import { UpdateFactMetricProps } from "../../../types/fact-table";
import { UpdateFactMetricResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { updateFactMetricValidator } from "../../validators/openapi";
import { findAllProjectsByOrganization } from "../../models/ProjectModel";

export function getUpdateFactMetricPropsFromBody(
  body: z.infer<typeof updateFactMetricValidator.bodySchema>
): UpdateFactMetricProps {
  const {
    numerator,
    denominator,
    cappingSettings,
    windowSettings,
    regressionAdjustmentSettings,
    ...otherFields
  } = body;

  const updates: UpdateFactMetricProps = {
    ...otherFields,
  };

  const metricType = updates.metricType;

  if (numerator) {
    updates.numerator = {
      filters: [],
      ...numerator,
      column:
        metricType === "proportion"
          ? "$$distinctUsers"
          : numerator.column || "$$distinctUsers",
    };
  }
  if (denominator) {
    updates.denominator = {
      filters: [],
      ...denominator,
      column: denominator.column || "$$distinctUsers",
    };
  }
  if (cappingSettings) {
    updates.capping =
      cappingSettings.type === "none" ? "" : cappingSettings.type;
    if (cappingSettings.value) {
      updates.capValue = cappingSettings.value;
    }
  }
  if (windowSettings) {
    updates.hasConversionWindow = windowSettings.type !== "none";
    if (windowSettings.delayHours) {
      updates.conversionDelayHours = windowSettings.delayHours;
    }
    if (windowSettings.windowValue) {
      updates.conversionWindowValue = windowSettings.windowValue;
    }
    if (windowSettings.windowUnit) {
      updates.conversionWindowUnit = windowSettings.windowUnit;
    }
  }
  if (regressionAdjustmentSettings) {
    updates.regressionAdjustmentOverride =
      regressionAdjustmentSettings.override;

    if (regressionAdjustmentSettings.override) {
      updates.regressionAdjustmentEnabled = !!regressionAdjustmentSettings.enabled;
      if (regressionAdjustmentSettings.days) {
        updates.regressionAdjustmentDays = regressionAdjustmentSettings.days;
      }
    }
  }

  return updates;
}

export const updateFactMetric = createApiRequestHandler(
  updateFactMetricValidator
)(
  async (req): Promise<UpdateFactMetricResponse> => {
    const factMetric = await req.context.factMetrics.getById(req.params.id);

    if (!factMetric) {
      throw new Error("Could not find factMetric with that id");
    }
    const updates = getUpdateFactMetricPropsFromBody(req.body);

    if (updates.projects?.length) {
      const projects = await findAllProjectsByOrganization(req.context);
      const projectIds = new Set(projects.map((p) => p.id));
      for (const projectId of updates.projects) {
        if (!projectIds.has(projectId)) {
          throw new Error(`Project ${projectId} not found`);
        }
      }
    }

    const newFactMetric = await req.context.factMetrics.update(
      factMetric,
      updates
    );

    return {
      factMetric: req.context.factMetrics.toApiInterface(newFactMetric),
    };
  }
);
