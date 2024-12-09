import z from "zod";
import {
  FactMetricInterface,
  FactTableInterface,
  UpdateFactMetricProps,
} from "back-end/types/fact-table";
import { UpdateFactMetricResponse } from "back-end/types/openapi";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateFactMetricValidator } from "back-end/src/validators/openapi";
import { validateAggregationSpecification } from "back-end/src/api/fact-metrics/postFactMetric";

export async function getUpdateFactMetricPropsFromBody(
  body: z.infer<typeof updateFactMetricValidator.bodySchema>,
  factMetric: FactMetricInterface,
  getFactTable: (id: string) => Promise<FactTableInterface | null>
): Promise<UpdateFactMetricProps> {
  const {
    numerator,
    denominator,
    cappingSettings,
    windowSettings,
    regressionAdjustmentSettings,
    riskThresholdSuccess,
    riskThresholdDanger,
    ...otherFields
  } = body;

  const updates: UpdateFactMetricProps = {
    ...otherFields,
    winRisk: riskThresholdSuccess,
    loseRisk: riskThresholdDanger,
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
    const factTable = await getFactTable(updates.numerator.factTableId);
    if (!factTable) {
      throw new Error("Could not find numerator fact table");
    }
    validateAggregationSpecification({
      errorPrefix: "Numerator misspecified. ",
      column: updates.numerator,
      factTable: factTable,
    });
  }
  if (denominator) {
    updates.denominator = {
      filters: [],
      ...denominator,
      column: denominator.column || "$$distinctUsers",
    };
    const factTable = await getFactTable(updates.denominator.factTableId);
    if (!factTable) {
      throw new Error("Could not find denominator fact table");
    }
    validateAggregationSpecification({
      errorPrefix: "Denominator misspecified. ",
      column: updates.denominator,
      factTable: factTable,
    });
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
    const lookupFactTable = async (id: string) => getFactTable(req.context, id);
    const updates = await getUpdateFactMetricPropsFromBody(
      req.body,
      factMetric,
      lookupFactTable
    );

    const newFactMetric = await req.context.models.factMetrics.update(
      factMetric,
      updates
    );

    return {
      factMetric: req.context.models.factMetrics.toApiInterface(newFactMetric),
    };
  }
);
