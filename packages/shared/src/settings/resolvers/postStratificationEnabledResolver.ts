import { DEFAULT_POST_STRATIFICATION_ENABLED } from "shared/constants";
import { SettingsResolver } from "../types";

/**
 * Resolver for post-stratification enabled setting.
 *
 * Resolution order:
 * 1. If pre-computed dimensions are turned off, return false
 * 2. If experiment has an explicit `postStratificationEnabled` value, use that
 * 3. Otherwise, use the org setting `postStratificationEnabled`
 *    - If undefined or true, post-stratification is ON
 *    - Only if explicitly false is it OFF
 */
const postStratificationEnabledResolver = (): SettingsResolver<boolean> => {
  return (ctx) => {
    // Get org-level setting (undefined or true means ON, only false means OFF)
    const orgPostStratificationEnabled =
      ctx.scopes?.organization?.settings?.postStratificationEnabled ??
      DEFAULT_POST_STRATIFICATION_ENABLED;

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
