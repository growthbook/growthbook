import { FeatureUpdatedNotificationHandler } from "../../notifiers/FeatureUpdatedNotifier";
import { ApiFeatureInterface } from "../../../../types/api";

export const slackHandleFeatureUpdatedNotification: FeatureUpdatedNotificationHandler = async (
  payload
) => {
  console.log("slackHandleFeatureUpdatedNotification -> ", payload);

  const feature: ApiFeatureInterface = payload.data;

  // Do async things
};
