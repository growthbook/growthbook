import { isBinomialMetric, isFactMetric } from "../../experiments.js";
import { Settings, SettingsContext, SettingsResolver } from "../types.js";

const regressionAdjustmentResolver = (
  field: "enabled" | "days",
): SettingsResolver<boolean | number> => {
  // todo: set `meta.scopeApplied`
  return (ctx: SettingsContext) => {
    // base settings
    let regressionAdjustmentEnabled = ctx.baseSettings
      .regressionAdjustmentEnabled
      .value as Settings["regressionAdjustmentEnabled"];
    let regressionAdjustmentDays = ctx.baseSettings.regressionAdjustmentDays
      .value as Settings["regressionAdjustmentDays"];

    let reason = ctx.baseSettings.regressionAdjustmentEnabled.meta.reason;

    if (ctx.scopes?.experiment?.regressionAdjustmentEnabled) {
      regressionAdjustmentEnabled =
        ctx.scopes.experiment.regressionAdjustmentEnabled;
    }

    // metric settings
    if (ctx.scopes?.metric?.regressionAdjustmentOverride) {
      regressionAdjustmentEnabled =
        !!ctx.scopes.metric.regressionAdjustmentEnabled;
      regressionAdjustmentDays =
        ctx.scopes.metric.regressionAdjustmentDays ?? regressionAdjustmentDays;
      if (!regressionAdjustmentEnabled) {
        reason = "disabled in metric settings";
      }
    }

    // experiment-level metric overrides
    const metricOverride = ctx.scopes?.experiment?.metricOverrides?.find(
      (mo) => mo.id === ctx.scopes?.metric?.id,
    );
    if (metricOverride?.regressionAdjustmentOverride) {
      regressionAdjustmentEnabled =
        !!metricOverride.regressionAdjustmentEnabled;
      regressionAdjustmentDays =
        metricOverride.regressionAdjustmentDays ?? regressionAdjustmentDays;
      reason = !regressionAdjustmentEnabled
        ? "disabled by metric override"
        : "experiment-level metric override applied";
    }
    //denominator metric checks
    if (regressionAdjustmentEnabled) {
      if (
        ctx.scopes?.denominatorMetric &&
        !isBinomialMetric(ctx.scopes?.denominatorMetric)
      ) {
        regressionAdjustmentEnabled = false;
        reason = `denominator is ${ctx.scopes?.denominatorMetric.type}. CUPED available for ratio metrics only if based on fact tables.`;
      }
    }

    // metrics with custom aggregation
    if (
      ctx.scopes?.metric &&
      !isFactMetric(ctx.scopes.metric) &&
      ctx.scopes.metric.aggregation
    ) {
      regressionAdjustmentEnabled = false;
      reason = "custom aggregation";
    }

    if (!regressionAdjustmentEnabled) {
      regressionAdjustmentDays = 0;
    }

    return {
      enabled: {
        value: regressionAdjustmentEnabled,
        meta: {
          reason,
        },
      },
      days: {
        value: regressionAdjustmentDays,
        meta: {},
      },
    }[field];
  };
};

export default regressionAdjustmentResolver;
