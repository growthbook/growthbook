import mongoose from "mongoose";

type SlackNotificationSnoozeInterface = {
  organizationId: string;
  eventWebHookId: string;
  experimentId: string;
  snoozedUntil: Date;
  dateCreated: Date;
};

const slackNotificationSnoozeSchema =
  new mongoose.Schema<SlackNotificationSnoozeInterface>({
    organizationId: { type: String, required: true },
    eventWebHookId: { type: String, required: true },
    experimentId: { type: String, required: true },
    snoozedUntil: { type: Date, required: true },
    dateCreated: { type: Date, required: true },
  });

slackNotificationSnoozeSchema.index({
  organizationId: 1,
  eventWebHookId: 1,
  experimentId: 1,
});
slackNotificationSnoozeSchema.index(
  { snoozedUntil: 1 },
  { expireAfterSeconds: 0 },
);

const SlackNotificationSnoozeModel =
  mongoose.model<SlackNotificationSnoozeInterface>(
    "SlackNotificationSnooze",
    slackNotificationSnoozeSchema,
  );

export const snoozeSlackExperimentNotifications = async ({
  organizationId,
  eventWebHookId,
  experimentId,
  snoozedUntil,
}: {
  organizationId: string;
  eventWebHookId: string;
  experimentId: string;
  snoozedUntil: Date;
}) => {
  await SlackNotificationSnoozeModel.updateOne(
    { organizationId, eventWebHookId, experimentId },
    {
      $set: {
        organizationId,
        eventWebHookId,
        experimentId,
        snoozedUntil,
        dateCreated: new Date(),
      },
    },
    { upsert: true },
  );
};

export const isSlackExperimentNotificationSnoozed = async ({
  organizationId,
  eventWebHookId,
  experimentId,
}: {
  organizationId: string;
  eventWebHookId: string;
  experimentId: string;
}) => {
  const snooze = await SlackNotificationSnoozeModel.findOne({
    organizationId,
    eventWebHookId,
    experimentId,
    snoozedUntil: { $gt: new Date() },
  });

  return !!snooze;
};
