export type AutoUpdateFailed = {
  type: "auto-update-failed";
  experimentName: string;
  experimentId: string;
};

export type MultipleExposures = {
  type: "multiple-exposures";
  experimentName: string;
  experimentId: string;
  usersCount: number;
};

export type ExperimentWarningNotificationPayload =
  | AutoUpdateFailed
  | MultipleExposures;

import { ExperimentInfoNotificationPayload as ModelExperimentInfoNotificationPayload } from "../models/ExperimentNotification";

export type ExperimentInfoNotificationPayload = ModelExperimentInfoNotificationPayload;
