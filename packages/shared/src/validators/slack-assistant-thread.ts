import { z } from "zod";
import { baseSchema } from "./base-model";

/** A Slack thread is its workspace, channel, and root message `ts`. */
export const slackThreadIdentitySchema = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  rootTs: z.string().min(1),
});
export type SlackThreadIdentity = z.infer<typeof slackThreadIdentitySchema>;

// Binds one Slack thread to the organization its messages are handled in.
// `id` is a hash of the thread identity, so the first writer wins and a
// binding is never repointed at another organization. `expiresAt` is set on a
// binding a notification created and cleared once someone converses in it.
export const slackAssistantThreadSchema = baseSchema.safeExtend({
  ...slackThreadIdentitySchema.shape,
  expiresAt: z.date().optional(),
});
export type SlackAssistantThreadInterface = z.infer<
  typeof slackAssistantThreadSchema
>;
