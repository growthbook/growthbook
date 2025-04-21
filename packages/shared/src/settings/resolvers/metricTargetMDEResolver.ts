import { SettingsResolver, Settings, SettingsContext } from "../types";

export default function metricTargetMDEResolver(): SettingsResolver<Settings[keyof Settings]> {
  return (ctx: SettingsContext) => {
    const metricTargetMDEOverride = ctx.scopes?.experiment?.metricTargetMDEOverrides?.find(
      (mo) => mo.id === ctx.scopes?.metric?.id
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

    if (ctx.scopes?.metric?.targetMDE !== undefined) {
      return {
        value: ctx.scopes?.metric?.targetMDE,
        meta: {
          scopeApplied: "metric",
          reason: "metric-level setting applied",
        },
      };
    }
    // TODO: report override?

    const metricDefaults = ctx.scopes?.organization.settings?.metricDefaults;

    return {
      value: metricDefaults?.targetMDE ?? null,
      meta: {
        scopeApplied: "organization",
        reason: "org-level setting applied",
      },
    };
  };
}
