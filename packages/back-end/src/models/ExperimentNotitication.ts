import { z } from "zod";
import { IfEqual } from "../util/types";
import { MakeModelClass, baseSchema } from "./BaseModel";

const notificationTriggers = ["snapshot"] as const;
const notificationLevels = ["alert", "info"] as const;
const notificationTypes = [
  "auto-update",
  "smr",
  "multiple-exposure",
  "metrics-change",
] as const;

const notificationConfigSchema = z.object({
  trigger: z.enum(notificationTriggers),
  level: z.enum(notificationLevels),
  type: z.enum(notificationTypes),
});

type NotificationConfigSchema = z.infer<typeof notificationConfigSchema>;

const autoUpdateNotification = {
  trigger: "snapshot",
  level: "alert",
  type: "auto-update",
} as const;

const smrNotification = {
  trigger: "snapshot",
  level: "alert",
  type: "smr",
} as const;

const multipleExposureNotification = {
  trigger: "snapshot",
  level: "alert",
  type: "multiple-exposure",
} as const;

const metricsChangeNotification = {
  trigger: "snapshot",
  level: "info",
  type: "metrics-change",
} as const;

const allNotificationConfig = [
  autoUpdateNotification,
  smrNotification,
  multipleExposureNotification,
  metricsChangeNotification,
] as const;

type AllNotificationConfig = typeof allNotificationConfig[number];

type AllNotificationConfigSchema = {
  [k in keyof AllNotificationConfig]: AllNotificationConfig[k];
};

export type NotificationConfig = IfEqual<
  AllNotificationConfigSchema,
  NotificationConfigSchema,
  AllNotificationConfig
>;

export const experimentNotificationValidator = baseSchema
  .merge(notificationConfigSchema)
  .extend({
    experiment: z.string(),
  })
  .strict();

export const ExperimentNotificationModel = MakeModelClass({
  schema: experimentNotificationValidator,
  collectionName: "experiment_notifications",
  idPrefix: "experiment_notifications__",
  auditLog: {
    entity: "metric",
    createEvent: "metric.create",
    updateEvent: "metric.update",
    deleteEvent: "metric.delete",
  },
  projectScoping: "none",
  globallyUniqueIds: false,
});
