import { z } from "zod";
import { updateFactMetricValidator } from "shared/validators";
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

/**
 * Returns the required column for metric types that enforce a specific column.
 * Returns null for metric types that allow user-specified columns.
 */
function getRequiredColumn(
  metricType: FactMetricType,
): "$$distinctUsers" | "$$distinctDates" | null {
  switch (metricType) {
    case "proportion":
    case "retention":
      return "$$distinctUsers";
    case "dailyParticipation":
      return "$$distinctDates";
    default:
      return null;
  }
}

/**
 * Validates numerator values for an update operation.
 *
 * When changing metric type, we auto-correct column/aggregation for ergonomics.
 * However, if the user explicitly provides incompatible values in the same request,
 * we error to prevent confusion.
 */
function validateNumeratorForUpdate(
  metricType: FactMetricType,
  numerator: { column?: string; aggregation?: string } | undefined,
  isChangingMetricType: boolean,
): void {
  if (!numerator) return;

  const requiredColumn = getRequiredColumn(metricType);
  if (!requiredColumn) return;

  // If user explicitly provides an incompatible column, error
  if (numerator.column && numerator.column !== requiredColumn) {
    if (isChangingMetricType) {
      throw new Error(
        `Cannot change metricType to "${metricType}" while setting numerator.column to "${numerator.column}". ` +
          `${metricType} metrics require column "${requiredColumn}". ` +
          `Either omit numerator.column to auto-correct, or use a compatible column value.`,
      );
    } else {
      throw new Error(
        `${metricType} metrics require numerator.column to be "${requiredColumn}". ` +
          `Received: "${numerator.column}"`,
      );
    }
  }

  // If user explicitly provides an aggregation for a metric type that doesn't support it, error
  if (numerator.aggregation) {
    if (isChangingMetricType) {
      throw new Error(
        `Cannot change metricType to "${metricType}" while setting numerator.aggregation. ` +
          `${metricType} metrics do not support aggregation. ` +
          `Either omit numerator.aggregation to auto-correct, or remove the aggregation field.`,
      );
    } else {
      throw new Error(
        `${metricType} metrics do not support numerator.aggregation. ` +
          `Remove the aggregation field from your request.`,
      );
    }
  }
}

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

  const metricType = updates.metricType ?? factMetric.metricType;
  const isChangingMetricType =
    updates.metricType !== undefined &&
    updates.metricType !== factMetric.metricType;

  // Validate that explicitly provided values are compatible with the metric type
  validateNumeratorForUpdate(metricType, numerator, isChangingMetricType);

  if (numerator) {
    // Set the correct column based on metric type (auto-correct for ergonomics)
    const requiredColumn = getRequiredColumn(metricType);
    const column = requiredColumn ?? numerator.column ?? "$$distinctUsers";

    updates.numerator = FactMetricModel.migrateColumnRef({
      ...numerator,
      column,
      // Clear aggregation for metric types that use special columns
      aggregation: requiredColumn ? undefined : numerator.aggregation,
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
