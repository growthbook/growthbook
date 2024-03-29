export type AutoUpdateFailed = {
  type: "auto-update-failed";
  experimentId: string;
};

export type ExperimentNotificationPayload = AutoUpdateFailed;
