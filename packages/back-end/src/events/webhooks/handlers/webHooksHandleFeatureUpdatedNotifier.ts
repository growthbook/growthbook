import { FeatureUpdatedNotificationHandler } from "../../notifiers/FeatureUpdatedNotifier";
import { ApiFeatureInterface } from "../../../../types/api";

export const webHooksHandleFeatureUpdatedNotifier: FeatureUpdatedNotificationHandler = async (
  payload
) => {
  console.log("webHooksHandleFeatureUpdatedNotifier -> ", payload);

  const feature: ApiFeatureInterface = payload.data;

  // Do async things
};
