import { getScopedSettings } from "shared/settings";
import { GetSettingsResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getSettingsValidator } from "back-end/src/validators/openapi";

export const getSettings = createApiRequestHandler(getSettingsValidator)(async (
  req,
): Promise<GetSettingsResponse> => {
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
      ? filteredSettings.requireReviews
      : [],
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
