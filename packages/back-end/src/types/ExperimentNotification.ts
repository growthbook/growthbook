export type AutoUpdateFailed = {
  type: "auto-update";
  experimentName: string;
  experimentId: string;
};

export type MultipleExposures = {
  type: "multiple-exposures";
  experimentName: string;
  experimentId: string;
  usersCount: number;
  percent: number;
};

export type SRM = {
  type: "srm";
  experimentName: string;
  experimentId: string;
  threshold: number;
};

export type ExperimentWarningNotificationPayload =
  | AutoUpdateFailed
  | MultipleExposures
  | SRM;
