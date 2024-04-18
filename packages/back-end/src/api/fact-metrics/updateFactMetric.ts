import z from "zod";
import {
  FactMetricInterface,
  UpdateFactMetricProps,
} from "../../../types/fact-table";
import { UpdateFactMetricResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { updateFactMetricValidator } from "../../validators/openapi";

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
    riskThresholdSuccess,
    riskThresholdDanger,
    minPercentChange,
    maxPercentChange,
    ...otherFields
  } = body;

  const updates: UpdateFactMetricProps = {
    ...otherFields,
  };

  const metricType = updates.metricType;

  if (riskThresholdDanger || riskThresholdSuccess) {
    updates.loseRisk = riskThresholdDanger ?? factMetric.loseRisk;
    updates.winRisk = riskThresholdSuccess ?? factMetric.winRisk;
    if (updates.loseRisk < updates.winRisk) {
      throw new Error(
        `riskThresholdDanger (${updates.loseRisk}) must be higher than riskThresholdSuccess ((${updates.winRisk}))`
      );
    }
  }
  if (maxPercentChange || minPercentChange) {
    updates.maxPercentChange = maxPercentChange ?? factMetric.maxPercentChange;
    updates.minPercentChange = minPercentChange ?? factMetric.minPercentChange;
    if (updates.maxPercentChange < updates.minPercentChange) {
      throw new Error(
        `maxPercentChange (${updates.maxPercentChange}) must be larger than minPercentChange (${updates.minPercentChange})`
      );
    }
  }
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
    const factMetric = await req.context.models.factMetrics.getById(
      req.params.id
    );
    if (!factMetric) {
      throw new Error("Could not find factMetric with that id");
    }
    const updates = getUpdateFactMetricPropsFromBody(req.body, factMetric);

    const newFactMetric = await req.context.models.factMetrics.update(
      factMetric,
      updates
    );

    return {
      factMetric: req.context.models.factMetrics.toApiInterface(newFactMetric),
    };
  }
);
