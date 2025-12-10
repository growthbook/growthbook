import { MetricOverride } from "shared/types/experiment";
import { MetricWindowSettings } from "shared/types/fact-table";
import { SettingsResolver, Settings, ScopeDefinition } from "../types";
import {
  getConversionWindowHours,
  getDelayWindowHours,
} from "../../experiments";

// skip RA and prior fields because they are handled by custom
// resolvers that take into account whether the requisite override
// field is true before choosing which scope to apply for the value
export default function genMetricOverrideResolver(
  fieldName: keyof Omit<
    MetricOverride,
    | "id"
    | "regressionAdjustmentOverride"
    | "regressionAdjustmentEnabled"
    | "regressionAdjustmentDays"
    | "properPriorOverride"
    | "properPriorEnabled"
    | "properPriorMean"
    | "properPriorStdDev"
  >,
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

    switch (fieldName) {
      case "delayHours":
        metricValue = ctx.scopes?.metric?.windowSettings
          ? getDelayWindowHours(ctx.scopes?.metric?.windowSettings)
          : null;
        break;
      case "windowHours":
        metricValue = ctx.scopes?.metric?.windowSettings
          ? getConversionWindowHours(ctx.scopes?.metric?.windowSettings)
          : null;
        break;
      case "windowType":
        metricValue = ctx.scopes?.metric?.windowSettings?.type;
        break;
      case "winRisk":
        metricValue = ctx.scopes?.metric?.winRisk;
        break;
      case "loseRisk":
        metricValue = ctx.scopes?.metric?.loseRisk;
        break;
      default: {
        // This should never happen according to our types, but keeping the default behavior in case
        const _exhaustiveCheck: never = fieldName;
        metricValue = ctx.scopes?.metric?.[fieldName];
        break;
      }
    }

    const baseSetting = ctx.baseSettings[fieldName]?.value;
    const value =
      metricOverride?.[fieldName] ?? metricValue ?? baseSetting ?? null;

    let scopeApplied: keyof ScopeDefinition | "organization" = "organization";
    let reason = "org-level setting applied";

    if (typeof metricOverride?.[fieldName] !== "undefined") {
      scopeApplied = "experiment";
      reason = "experiment-level metric override applied";
    } else if (typeof metricValue !== "undefined") {
      scopeApplied = "metric";
      reason = "metric-level setting applied";
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
