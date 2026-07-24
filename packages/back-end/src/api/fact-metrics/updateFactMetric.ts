import { z } from "zod";
import {
  getCappingTailState,
  updateFactMetricValidator,
} from "shared/validators";
import {
  FactMetricInterface,
  FactMetricType,
  FactTableInterface,
  UpdateFactMetricProps,
} from "shared/types/fact-table";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { FactMetricModel } from "back-end/src/models/FactMetricModel";

function expectsDenominator(metricType: FactMetricType) {
  switch (metricType) {
    case "ratio":
      return true;
    case "mean":
    case "proportion":
    case "quantile":
    case "retention":
    case "dailyParticipation":
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

  const metricType = updates.metricType ?? factMetric.metricType;
  if (numerator) {
    // Set the correct column based on metric type
    let column: string;
    if (metricType === "proportion" || metricType === "retention") {
      column = "$$distinctUsers";
    } else if (metricType === "dailyParticipation") {
      column = "$$distinctDates";
    } else {
      column = numerator.column || "$$distinctUsers";
    }

    updates.numerator = FactMetricModel.migrateColumnRef({
      ...numerator,
      column,
      // Clear aggregation for metric types that use special columns
      aggregation:
        metricType === "proportion" ||
        metricType === "retention" ||
        metricType === "dailyParticipation"
          ? undefined
          : numerator.aggregation,
    });
    const factTable = await getFactTable(updates.numerator.factTableId);
    if (!factTable) {
      throw new Error("Could not find numerator fact table");
    }
  }
  // remove denominator for non-ratio metrics where existing
  // metric is a ratio metric
  if (
    expectsDenominator(factMetric.metricType) &&
    metricType &&
    !expectsDenominator(metricType)
  ) {
    updates.denominator = null;
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
  }
  if (cappingSettings) {
    updates.cappingSettings = {
      type: cappingSettings.type === "none" ? "" : cappingSettings.type,
      value: cappingSettings.value ?? factMetric.cappingSettings.value,
      ignoreZeros:
        cappingSettings.ignoreZeros ?? factMetric.cappingSettings.ignoreZeros,
    };

    // Independent lower-tail capping (own type/value/ignoreZeros).
    const lowerCappingSettings = cappingSettings.lowerCappingSettings;
    if (lowerCappingSettings !== undefined) {
      const prevLower = factMetric.lowerCappingSettings;
      const lowerType =
        lowerCappingSettings.type === "none" ? "" : lowerCappingSettings.type;
      const lowerValue = lowerCappingSettings.value ?? prevLower?.value ?? 0;
      const lowerTails = getCappingTailState(undefined, {
        type: lowerType,
        value: lowerValue,
      });
      if (lowerTails.lowerPercentileCapped || lowerTails.lowerAbsoluteCapped) {
        updates.lowerCappingSettings = {
          type: lowerType,
          value: lowerValue,
          ignoreZeros: lowerTails.lowerPercentileCapped
            ? (lowerCappingSettings.ignoreZeros ??
              prevLower?.ignoreZeros ??
              false)
            : false,
        };
      } else {
        // Explicitly clear the lower tail when disabled.
        updates.lowerCappingSettings = null;
      }
    }
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
      if (regressionAdjustmentSettings.days != null) {
        updates.regressionAdjustmentDays = regressionAdjustmentSettings.days;
      }
    }
  }

  return updates;
}

export const updateFactMetric = createApiRequestHandler(
  updateFactMetricValidator,
)(async (req) => {
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
    factMetric: await resolveOwnerEmail(
      req.context.models.factMetrics.toApiInterface(newFactMetric),
      req.context,
    ),
  };
});
