import { pick } from "lodash";
import { getScopedSettings } from "shared/settings";
import {
  API_READ_ONLY_SETTING_KEYS,
  API_WRITABLE_SETTING_KEYS,
  getSettingsValidator,
} from "shared/validators";
import { getRequireRegisteredAttributesSettings } from "shared/util";
import { OrganizationInterface } from "shared/types/organization";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  toApiRequireReviews,
  toApiSavedGroupApprovals,
} from "./approvalRuleShapes";

export const getSettings = createApiRequestHandler(getSettingsValidator)(async (
  req,
) => {
  return {
    settings: toApiSettings(req.context.org),
  };
});

export function toApiSettings(org: OrganizationInterface) {
  const { settings: scopedSettings } = getScopedSettings({
    organization: org,
  });

  const settingsValues = extractSettingValues(scopedSettings);

  // Remove deprecated settings
  const {
    sdkInstructionsViewed: _sdk,
    videoInstructionsViewed: _video,
    ...filteredSettings
  } = settingsValues;

  // Settings with no scoped resolver are read straight off the org.
  const stored = org.settings ?? {};

  return {
    ...pick(stored, [
      ...API_WRITABLE_SETTING_KEYS,
      ...API_READ_ONLY_SETTING_KEYS,
    ]),
    requireRegisteredAttributes:
      stored.requireRegisteredAttributes !== undefined
        ? getRequireRegisteredAttributesSettings(
            stored.requireRegisteredAttributes,
          )
        : undefined,
    ...filteredSettings,
    requireReviews: Array.isArray(filteredSettings.requireReviews)
      ? toApiRequireReviews(filteredSettings.requireReviews)
      : [],
    approvalFlows: {
      savedGroups: toApiSavedGroupApprovals(
        stored.approvalFlows?.savedGroups ?? [],
      ),
    },
    experimentMaxLengthDays: filteredSettings.experimentMaxLengthDays ?? null,
    preferredEnvironment: stored.preferredEnvironment ?? null,
  };
}

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
