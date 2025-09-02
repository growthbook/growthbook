import { getScopedSettings, Settings, Setting } from "shared/settings";
import { GetSettingsResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getSettingsValidator } from "back-end/src/validators/openapi";

export const getSettings = createApiRequestHandler(getSettingsValidator)(async (
  req,
): Promise<GetSettingsResponse> => {
  const { settings } = getScopedSettings({
    organization: req.context.org,
  });

  const settingsValues = Object.entries(settings).reduce(
    (acc, [settingName, setting]) => {
      acc[settingName] = setting.value;
      return acc;
    },
    {} as Record<string, Setting<keyof Settings> | undefined | null>,
  );

  return {
    settings: settingsValues,
  };
});
