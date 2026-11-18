import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import { getScopedSettings } from "shared/settings";
import { getSettingsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  toApiRequireReviews,
  toApiSavedGroupApprovals,
  toApiSdkConnectionApprovals,
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

  const orgSettings = req.context.org.settings;
  const settings = {
    ...filteredSettings,
    requireReviews: Array.isArray(filteredSettings.requireReviews)
      ? toApiRequireReviews(filteredSettings.requireReviews)
      : [],
    // Not scoped settings, so read them straight off the org.
    approvalFlows: {
      savedGroups: toApiSavedGroupApprovals(
        orgSettings?.approvalFlows?.savedGroups ?? [],
      ),
      sdkConnections: toApiSdkConnectionApprovals(
        req.context.org.settings?.approvalFlows?.sdkConnections ?? [],
      ),
    },
    restApiBypassesReviews: !!orgSettings?.restApiBypassesReviews,
    requireRebaseBeforePublish: !!orgSettings?.requireRebaseBeforePublish,
    revertsBypassApproval: !!orgSettings?.revertsBypassApproval,
    maxConcurrentDrafts: orgSettings?.maxConcurrentDrafts ?? 0,
    sparseJSONRulesByDefault: !!orgSettings?.sparseJSONRulesByDefault,
    experimentMaxLengthDays: filteredSettings.experimentMaxLengthDays ?? null,
    winRisk: DEFAULT_WIN_RISK_THRESHOLD,
    loseRisk: DEFAULT_LOSE_RISK_THRESHOLD,
    preferredEnvironment: orgSettings?.preferredEnvironment ?? null,
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
