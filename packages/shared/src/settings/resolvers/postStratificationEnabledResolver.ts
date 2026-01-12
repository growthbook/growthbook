import { SettingsResolver } from "../types";

/**
 * Resolver for post-stratification enabled setting.
 *
 * The org setting is `postStratificationDisabled` (inverted - when true, post-strat is OFF),
 * but we expose it as `postStratificationEnabled` (when true, post-strat is ON).
 *
 * Resolution order:
 * 1. If experiment has an explicit `postStratificationEnabled` value, use that
 * 2. Otherwise, use the org default: `!postStratificationDisabled` (enabled by default)
 */
const postStratificationEnabledResolver = (): SettingsResolver<boolean> => {
  return (ctx) => {
    // Get org-level setting (inverted: postStratificationDisabled -> postStratificationEnabled)
    const orgPostStratificationDisabled =
      ctx.scopes?.organization?.settings?.postStratificationDisabled ?? false;
    const orgPostStratificationEnabled = !orgPostStratificationDisabled;

    // Check if experiment has an explicit setting
    const experimentPostStratificationEnabled =
      ctx.scopes?.experiment?.postStratificationEnabled;

    if (experimentPostStratificationEnabled !== undefined) {
      return {
        value: experimentPostStratificationEnabled,
        meta: {
          scopeApplied: "experiment",
          reason: "experiment-level setting applied",
        },
      };
    }

    return {
      value: orgPostStratificationEnabled,
      meta: {
        scopeApplied: "organization",
        reason: "org-level setting applied",
      },
    };
  };
};

export default postStratificationEnabledResolver;
