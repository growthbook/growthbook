import { FeatureUpdatedNotificationHandler } from "../../notifiers/FeatureUpdatedNotifier";
import { ApiFeatureInterface } from "../../../../types/api";

export const webHooksHandleFeatureUpdatedNotification: FeatureUpdatedNotificationHandler = async (
  payload
) => {
  console.log("webHooksHandleFeatureUpdatedNotification -> ", payload);

  const feature: ApiFeatureInterface = payload.data;

  // Do async things
};
