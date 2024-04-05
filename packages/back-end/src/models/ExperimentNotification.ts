import { z } from "zod";
import { MakeModelClass, baseSchema } from "./BaseModel";

const notificationTriggers = ["snapshot"] as const;

export const experimentNotificationValidator = baseSchema
  .extend({
    experimentId: z.string(),
    metricId: z.string(),
    trigger: z.enum(notificationTriggers),
  })
  .strict();

export type ExperimentInfoNotificationPayload = z.infer<
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

  onTrigger(_: ExperimentInfoNotificationPayload) {}
}
