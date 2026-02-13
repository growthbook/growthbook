import { DEFAULT_TARGET_MDE } from "../../constants.js";
import { SettingsResolver, Settings, SettingsContext } from "../types.js";

export default function metricTargetMDEResolver(): SettingsResolver<
  Settings[keyof Settings]
> {
  return (ctx: SettingsContext) => {
    const metricTargetMDEOverride =
      ctx.scopes?.experiment?.decisionFrameworkSettings?.decisionFrameworkMetricOverrides?.find(
        (mo) => mo.id === ctx.scopes?.metric?.id,
      );

    if (metricTargetMDEOverride?.targetMDE !== undefined) {
      return {
        value: metricTargetMDEOverride.targetMDE,
        meta: {
          scopeApplied: "experiment",
          reason: "experiment-level metric target MDE override applied",
        },
      };
    }

    return {
      value: ctx.scopes?.metric?.targetMDE ?? DEFAULT_TARGET_MDE,
      meta: {
        scopeApplied: "metric",
        reason: "metric-level setting applied",
      },
    };
  };
}
