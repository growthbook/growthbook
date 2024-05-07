import { MetricOverride } from "back-end/types/experiment";
import { MetricWindowSettings } from "back-end/types/fact-table";
import { SettingsResolver, Settings, ScopeDefinition } from "../types";
import { getConversionWindowHours } from "../../experiments";

export default function genMetricOverrideResolver(
  fieldName: keyof Omit<MetricOverride, "id">,
): SettingsResolver<Settings[keyof Settings]> {
  return (ctx) => {
    const metricOverride = ctx.scopes?.experiment?.metricOverrides?.find(
      (mo) => mo.id === ctx.scopes?.metric?.id,
    );

    let metricValue:
      | number
      | boolean
      | MetricWindowSettings["type"]
      | null
      | undefined = null;
    if (fieldName == "delayHours") {
      metricValue = ctx.scopes?.metric?.windowSettings?.delayHours;
    } else if (fieldName == "windowHours") {
      metricValue = ctx.scopes?.metric?.windowSettings
        ? getConversionWindowHours(ctx.scopes?.metric?.windowSettings)
        : null;
    } else if (fieldName == "windowType") {
      metricValue = ctx.scopes?.metric?.windowSettings?.type;
    } else {
      metricValue = ctx.scopes?.metric?.[fieldName];
    }

    const value =
      metricOverride?.[fieldName] ??
      metricValue ??
      (fieldName === "regressionAdjustmentEnabled"
        ? ctx.scopes?.experiment?.[fieldName]
        : null) ??
      null;

    let scopeApplied: keyof ScopeDefinition | "organization" = "organization";
    let reason = "org-level setting applied";

    if (typeof metricOverride?.[fieldName] !== "undefined") {
      scopeApplied = "experiment";
      reason = "experiment-level metric override applied";
    } else if (typeof metricValue !== "undefined") {
      scopeApplied = "metric";
      reason = "metric-level setting applied";
    } else if (
      fieldName === "regressionAdjustmentEnabled" &&
      typeof ctx.scopes?.experiment?.[fieldName] !== "undefined"
    ) {
      scopeApplied = "experiment";
      reason = "experiment-level setting applied";
    }

    return {
      value,
      meta: {
        scopeApplied,
        reason,
      },
    };
  };
}
