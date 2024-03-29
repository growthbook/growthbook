import { z } from "zod";
import { MakeModelClass, baseSchema } from "./BaseModel";

const notificationTriggers = ["snapshot"] as const;
const notificationLevels = ["alert", "info"] as const;

const notificationConfigSchema = z.object({
  trigger: z.enum(notificationTriggers),
  level: z.enum(notificationLevels),
});

export const experimentNotificationValidator = baseSchema
  .merge(notificationConfigSchema)
  .extend({
    experimentId: z.string(),
  })
  .strict();

type ExperimentNotificationPayload = z.infer<
  typeof experimentNotificationValidator
>;

const ExperimentNotificationBase = MakeModelClass({
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

export class ExperimentNotificationModel extends ExperimentNotificationBase {
  canRead() {
    return true;
  }
  canUpdate() {
    return true;
  }
  canCreate() {
    return true;
  }
  canDelete() {
    return true;
  }

  onTrigger(_: ExperimentNotificationPayload) {}
}
