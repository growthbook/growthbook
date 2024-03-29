export type AutoUpdateFailed = {
  type: "auto-update-failed";
  experimentName: string;
  experimentId: string;
};

export type ExperimentNotificationPayload = AutoUpdateFailed;
