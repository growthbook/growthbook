import z from "zod";
import { updateFactMetricValidator } from "@back-end/src/validators/openapi";
import {
  FactMetricInterface,
  UpdateFactMetricProps,
} from "@back-end/types/fact-table";
import { UpdateFactMetricResponse } from "@back-end/types/openapi";
import {
  updateFactMetric as updateFactMetricInDb,
  toFactMetricApiInterface,
  getFactMetric,
} from "@back-end/src/models/FactMetricModel";
import { addTagsDiff } from "@back-end/src/models/TagModel";
import { getFactTable } from "@back-end/src/models/FactTableModel";
import { findAllProjectsByOrganization } from "@back-end/src/models/ProjectModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";
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
    const factMetric = await getFactMetric(req.context, req.params.id);

    if (!factMetric) {
      throw new Error("Could not find factMetric with that id");
    }

    const updates = getUpdateFactMetricPropsFromBody(req.body, factMetric);

    if (!req.context.permissions.canUpdateMetric(factMetric, updates)) {
      req.context.permissions.throwPermissionError();
    }

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
