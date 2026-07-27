import { z } from "zod";
import { baseSchema } from "./base-model";

// A temporary mute of one experiment's Slack notifications in one connected
// channel. Written when someone clicks "Snooze 24h" on a notification; read on
// the delivery path to suppress further posts until `snoozedUntil`.
export const slackNotificationSnoozeValidator = baseSchema
  .extend({
    eventWebHookId: z.string(),
    experimentId: z.string(),
    snoozedUntil: z.date(),
  })
  .strict();

export type SlackNotificationSnoozeInterface = z.infer<
  typeof slackNotificationSnoozeValidator
>;
