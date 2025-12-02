import { z } from "zod";
import {
  FactMetricInterface,
  FactMetricType,
  FactTableInterface,
  UpdateFactMetricProps,
} from "back-end/types/fact-table";
import { UpdateFactMetricResponse } from "back-end/types/openapi";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateFactMetricValidator } from "back-end/src/validators/openapi";
import { validateAggregationSpecification } from "back-end/src/api/fact-metrics/postFactMetric";
import { FactMetricModel } from "back-end/src/models/FactMetricModel";

function expectsDenominator(metricType: FactMetricType) {
  switch (metricType) {
    case "ratio":
      return true;
    case "mean":
    case "proportion":
    case "quantile":
    case "retention":
      return false;
  }
}

export async function getUpdateFactMetricPropsFromBody(
  body: z.infer<typeof updateFactMetricValidator.bodySchema>,
  factMetric: FactMetricInterface,
  getFactTable: (id: string) => Promise<FactTableInterface | null>,
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
    updates.numerator = FactMetricModel.migrateColumnRef({
      ...numerator,
      column:
        metricType === "proportion" || metricType === "retention"
          ? "$$distinctUsers"
          : numerator.column || "$$distinctUsers",
    });
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
  // remove denominator for non-ratio metrics where existing
  // metric is a ratio metric
  if (
    expectsDenominator(factMetric.metricType) &&
    metricType &&
    !expectsDenominator(metricType)
  ) {
    updates.denominator = undefined;
  }
  if (denominator) {
    updates.denominator = FactMetricModel.migrateColumnRef({
      ...denominator,
      column: denominator.column || "$$distinctUsers",
    });
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
      delayValue:
        windowSettings.delayValue ??
        windowSettings.delayHours ??
        factMetric.windowSettings.delayValue,
      delayUnit:
        windowSettings.delayUnit ??
        (windowSettings.delayHours ? "hours" : undefined) ??
        factMetric.windowSettings.delayUnit,
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
      updates.regressionAdjustmentEnabled =
        !!regressionAdjustmentSettings.enabled;
      if (regressionAdjustmentSettings.days) {
        updates.regressionAdjustmentDays = regressionAdjustmentSettings.days;
      }
    }
  }

  return updates;
}

export const updateFactMetric = createApiRequestHandler(
  updateFactMetricValidator,
)(async (req): Promise<UpdateFactMetricResponse> => {
  const factMetric = await req.context.models.factMetrics.getById(
    req.params.id,
  );
  if (!factMetric) {
    throw new Error("Could not find factMetric with that id");
  }

  if (
    req.body.metricAutoSlices &&
    req.body.metricAutoSlices.length > 0 &&
    !req.context.hasPremiumFeature("metric-slices")
  ) {
    throw new Error("Metric slices require an enterprise license");
  }

  const lookupFactTable = async (id: string) => getFactTable(req.context, id);
  const updates = await getUpdateFactMetricPropsFromBody(
    req.body,
    factMetric,
    lookupFactTable,
  );

  const newFactMetric = await req.context.models.factMetrics.update(
    factMetric,
    updates,
  );

  return {
    factMetric: req.context.models.factMetrics.toApiInterface(newFactMetric),
  };
});
