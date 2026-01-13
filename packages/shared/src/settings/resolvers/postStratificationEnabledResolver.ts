import { SettingsResolver } from "../types";

/**
 * Resolver for post-stratification enabled setting.
 *
 * The org setting is `postStratificationDisabled` (inverted - when true, post-strat is OFF),
 * but we expose it as `postStratificationEnabled` (when true, post-strat is ON).
 *
 * Resolution order:
 * 1. If pre-computed dimensions are turned off, return false
 * 2. If experiment has an explicit `postStratificationEnabled` value, use that
 * 3. Otherwise, use the org default: `!postStratificationDisabled` (enabled by default)
 */
const postStratificationEnabledResolver = (): SettingsResolver<boolean> => {
  return (ctx) => {
    // Get org-level setting (inverted: postStratificationDisabled -> postStratificationEnabled)
    const orgPostStratificationDisabled =
      ctx.scopes?.organization?.settings?.postStratificationDisabled ?? false;
    const orgPostStratificationEnabled = !orgPostStratificationDisabled;

    // Check if experiment has an explicit setting (null or undefined means use default)
    const experimentPostStratificationEnabled =
      ctx.scopes?.experiment?.postStratificationEnabled;

    // Check if pre-computed dimensions are turned off
    const precomputedDimensionsEnabled =
      !ctx.scopes?.organization?.settings?.disablePrecomputedDimensions;
    if (!precomputedDimensionsEnabled) {
      return {
        value: false,
        meta: {
          scopeApplied: "organization",
          reason: "pre-computed dimensions are turned off",
        },
      };
    }

    if (
      experimentPostStratificationEnabled !== undefined &&
      experimentPostStratificationEnabled !== null
    ) {
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
