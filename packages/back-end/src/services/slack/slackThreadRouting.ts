import { z } from "zod";
import { getCollection } from "back-end/src/util/mongo.util";
import { logger } from "back-end/src/util/logger";
import {
  isDuplicateKeyError,
  slackTaskKey,
} from "back-end/src/services/slack/slackTaskSafety";

export const slackAssistantMentionSchema = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  slackUserId: z.string().min(1),
  text: z.string(),
  messageTs: z.string().min(1),
  // Agenda persists absent optional fields as BSON null.
  threadTs: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined)
    .optional(),
  botUserId: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined)
    .optional(),
  requireActiveThread: z
    .boolean()
    .nullable()
    .transform((value) => value ?? undefined)
    .optional(),
});
export type SlackAssistantMention = z.infer<typeof slackAssistantMentionSchema>;
const threadIdentitySchema = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  rootTs: z.string().min(1),
});
export type SlackThreadIdentity = z.infer<typeof threadIdentitySchema>;
const threadSchema = threadIdentitySchema.extend({
  _id: z.string(),
  dateUpdated: z.date(),
  status: z.literal("selected"),
  organizationId: z.string().min(1),
  expiresAt: z.date().optional(),
});
export type SlackThread = z.infer<typeof threadSchema>;
// Pins preserve the organization when a workspace is disconnected and reconnected.
const collection = () => getCollection<SlackThread>("slackassistantthreads");
const threadKey = ({ teamId, channelId, rootTs }: SlackThreadIdentity) =>
  slackTaskKey([teamId, channelId, rootTs]);
const NOTIFICATION_PIN_DAYS = 90;
let expiryIndex: Promise<void> | null = null;
function ensureThreadExpiryIndex(): Promise<void> {
  if (!expiryIndex)
    expiryIndex = collection()
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .then(() => undefined)
      .catch((error) => {
        logger.warn(error, "Could not create the Slack thread expiry index");
      });
  return expiryIndex;
}

export async function getSlackThread(
  identity: SlackThreadIdentity,
): Promise<SlackThread | null> {
  const doc = await collection().findOne({ _id: threadKey(identity) });
  return doc && doc.status === "selected" ? threadSchema.parse(doc) : null;
}

export async function pinSlackNotificationThread(
  identity: SlackThreadIdentity,
  organizationId: string,
): Promise<void> {
  await ensureThreadExpiryIndex();
  try {
    await collection().updateOne(
      { _id: threadKey(identity) },
      {
        $setOnInsert: {
          ...identity,
          status: "selected",
          organizationId,
          dateUpdated: new Date(),
          expiresAt: new Date(
            Date.now() + NOTIFICATION_PIN_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
}

export async function pinSlackThreadOrganization(
  identity: SlackThreadIdentity,
  organizationId: string,
): Promise<SlackThread> {
  await ensureThreadExpiryIndex();
  const _id = threadKey(identity);
  try {
    await collection().updateOne(
      { _id },
      {
        $setOnInsert: {
          ...identity,
          status: "selected",
          organizationId,
          dateUpdated: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const thread = await getSlackThread(identity);
  if (!thread)
    throw new Error("Could not save the Slack thread's organization.");
  if (thread.organizationId === organizationId && thread.expiresAt) {
    // A thread someone is conversing in outlives the notification pin's expiry.
    await collection().updateOne(
      { _id, status: "selected", organizationId },
      { $unset: { expiresAt: "" } },
    );
    delete thread.expiresAt;
  }
  return thread;
}

export function slackConversationId(
  identity: SlackThreadIdentity & {
    organizationId: string;
    slackUserId: string;
    userId: string;
    linkId: string;
  },
): string {
  return `conv_slack_${slackTaskKey([identity.teamId, identity.channelId, identity.rootTs, identity.organizationId, identity.slackUserId, identity.userId, identity.linkId])}`;
}
