import { getScopedSettings } from "shared/settings";
import { GetSettingsResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getSettingsValidator } from "back-end/src/validators/openapi";
import { toSettingsApiInterface } from "back-end/src/models/SettingsModel";

export const getSettings = createApiRequestHandler(getSettingsValidator)(
  async (req): Promise<GetSettingsResponse> => {
    const { settings } = await getScopedSettings({
      organization: req.context.org,
    });
    if (!settings) {
      throw new Error(`Settings not available for ${req.context.org.id}.`);
    }

    return {
      settings: await toSettingsApiInterface(settings),
    };
  }
);
