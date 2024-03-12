import z from "zod";
import {
  FactMetricInterface,
  UpdateFactMetricProps,
} from "../../../types/fact-table";
import { UpdateFactMetricResponse } from "../../../types/openapi";
import {
  updateFactMetric as updateFactMetricInDb,
  toFactMetricApiInterface,
  getFactMetric,
} from "../../models/FactMetricModel";
import { addTagsDiff } from "../../models/TagModel";
import { createApiRequestHandler } from "../../util/handler";
import { updateFactMetricValidator } from "../../validators/openapi";
import { getFactTable } from "../../models/FactTableModel";
import { findAllProjectsByOrganization } from "../../models/ProjectModel";
import { validateFactMetric } from "./postFactMetric";

export function getUpdateFactMetricPropsFromBody(
  body: z.infer<typeof updateFactMetricValidator.bodySchema>,
  factMetric: FactMetricInterface
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
    updates.cappingSettings = {
      type: cappingSettings.type === "none" ? "" : cappingSettings.type,
      value: cappingSettings.value ?? factMetric.cappingSettings.value,
      ignoreZeros:
        cappingSettings.ignoreZeros ?? factMetric.cappingSettings.ignoreZeros,
    };
  }
  if (windowSettings) {
    updates.windowSettings = {
      type: windowSettings.type === "none" ? "" : windowSettings.type,
      delayHours:
        windowSettings.delayHours ?? factMetric.windowSettings.delayHours,
      windowValue:
        windowSettings.windowValue ?? factMetric.windowSettings.windowValue,
      windowUnit:
        windowSettings.windowUnit ?? factMetric.windowSettings.windowUnit,
    };
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
    const { canCreateMetrics, throwPermissionError } = req.context.permissions;
    const factMetric = await getFactMetric(req.context, req.params.id);

    if (!factMetric) {
      throw new Error("Could not find factMetric with that id");
    }

    if (!canCreateMetrics(factMetric)) {
      throwPermissionError();
    }

    const updates = getUpdateFactMetricPropsFromBody(req.body, factMetric);

    if (updates.projects?.length) {
      const projects = await findAllProjectsByOrganization(req.context);
      const projectIds = new Set(projects.map((p) => p.id));
      for (const projectId of updates.projects) {
        if (!projectIds.has(projectId)) {
          throw new Error(`Project ${projectId} not found`);
        }
      }
    }

    await validateFactMetric({ ...factMetric, ...updates }, async (id) => {
      return getFactTable(req.context, id);
    });

    await updateFactMetricInDb(req.context, factMetric, updates);

    if (updates.tags) {
      await addTagsDiff(req.organization.id, factMetric.tags, updates.tags);
    }

    return {
      factMetric: toFactMetricApiInterface({
        ...factMetric,
        ...updates,
      }),
    };
  }
);
