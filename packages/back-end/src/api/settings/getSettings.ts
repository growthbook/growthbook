import { getScopedSettings } from "shared/settings";
import { getSettingsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  toApiRequireReviews,
  toApiSavedGroupApprovals,
} from "./approvalRuleShapes";

export const getSettings = createApiRequestHandler(getSettingsValidator)(async (
  req,
) => {
  const { settings: scopedSettings } = getScopedSettings({
    organization: req.context.org,
  });

  const settingsValues = extractSettingValues(scopedSettings);

  // Remove deprecated settings
  const {
    sdkInstructionsViewed: _sdk,
    videoInstructionsViewed: _video,
    ...filteredSettings
  } = settingsValues;

  const settings = {
    ...filteredSettings,
    requireReviews: Array.isArray(filteredSettings.requireReviews)
      ? toApiRequireReviews(filteredSettings.requireReviews)
      : [],
    // Not a scoped setting, so read it straight off the org.
    approvalFlows: {
      savedGroups: toApiSavedGroupApprovals(
        req.context.org.settings?.approvalFlows?.savedGroups ?? [],
      ),
      // Read back what the PUT accepts, so a round-trip doesn't drop rules.
      sdkConnections: toApiSavedGroupApprovals(
        req.context.org.settings?.approvalFlows?.sdkConnections ?? [],
      ),
    },
    experimentMaxLengthDays: filteredSettings.experimentMaxLengthDays ?? null,
    preferredEnvironment:
      req.context.org.settings?.preferredEnvironment ?? null,
  };

  return {
    settings,
  };
});

/**
 * Extracts the 'value' property from each Setting<T> in the provided object
 *
 */
function extractSettingValues<T extends Record<string, { value: unknown }>>(
  scopedSettings: T,
): { [K in keyof T]: T[K]["value"] } {
  return Object.fromEntries(
    Object.entries(scopedSettings).map(([key, setting]) => [
      key,
      setting.value,
    ]),
  ) as { [K in keyof T]: T[K]["value"] };
}
