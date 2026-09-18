import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCollection } from "back-end/src/util/mongo.util";
import { logger } from "back-end/src/util/logger";
import {
  isDuplicateKeyError,
  slackTaskKey,
} from "back-end/src/services/slack/slackTaskSafety";
import type { SlackOrganizationChoice } from "back-end/src/services/slack/slackIdentity";

export function isSlackDirectMessageChannel(channelId: string): boolean {
  return /^D[A-Z0-9]+$/.test(channelId);
}

export const slackAssistantMentionSchema = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  slackUserId: z.string().min(1),
  text: z.string(),
  messageTs: z.string().min(1),
  threadTs: z.string().optional(),
  botUserId: z.string().optional(),
  requireActiveThread: z.boolean().optional(),
  resumeAfterLink: z
    .object({
      organizationId: z.string().min(1),
      userId: z.string().min(1),
      linkId: z.string().min(1),
      expiresAt: z.number().finite(),
    })
    .optional(),
});
export type SlackAssistantMention = z.infer<typeof slackAssistantMentionSchema>;
export const slackOrganizationSelectionValueSchema = z.strictObject({
  s: z.string().min(1),
  o: z.string().min(1),
  t: z.string().min(1),
});
export const slackOrganizationSelectionSchema = z.strictObject({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  slackUserId: z.string().min(1),
  selectionId: z.string().min(1),
  organizationId: z.string().min(1),
  threadTs: z.string().min(1),
  interactionTs: z.string().min(1),
});
export type SlackOrganizationSelection = z.infer<
  typeof slackOrganizationSelectionSchema
>;
const threadIdentitySchema = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  rootTs: z.string().min(1),
});
export type SlackThreadIdentity = z.infer<typeof threadIdentitySchema>;
const threadBase = threadIdentitySchema.extend({
  _id: z.string(),
  dateUpdated: z.date(),
});
const threadSchema = z.discriminatedUnion("status", [
  threadBase.extend({
    status: z.literal("selected"),
    organizationId: z.string().min(1),
    expiresAt: z.date().optional(),
  }),
  threadBase.extend({
    status: z.literal("pending"),
    selectionId: z.string(),
    mention: slackAssistantMentionSchema,
    choices: z.array(
      z.object({
        organizationId: z.string(),
        name: z.string(),
        linkId: z.string(),
      }),
    ),
  }),
]);
export type SlackThread = z.infer<typeof threadSchema>;
// Routing exists before an org is chosen. These infrastructure records are bound
// to signed Slack identities rather than BaseModel's already-resolved org context.
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
  return doc ? threadSchema.parse(doc) : null;
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
      { _id, status: { $ne: "selected" } },
      {
        $set: {
          ...identity,
          status: "selected",
          organizationId,
          dateUpdated: new Date(),
        },
        $unset: { selectionId: "", mention: "", choices: "" },
      },
      { upsert: true },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const thread = await getSlackThread(identity);
  if (!thread)
    throw new Error("Could not save the Slack thread's organization.");
  if (
    thread.status === "selected" &&
    thread.organizationId === organizationId &&
    thread.expiresAt
  ) {
    // A thread someone is conversing in outlives the notification pin's expiry.
    await collection().updateOne(
      { _id, status: "selected", organizationId },
      { $unset: { expiresAt: "" } },
    );
    delete thread.expiresAt;
  }
  return thread;
}

export async function saveSlackOrganizationPicker(
  mention: SlackAssistantMention,
  choices: SlackOrganizationChoice[],
): Promise<SlackThread> {
  const identity = {
    teamId: mention.teamId,
    channelId: mention.channelId,
    rootTs: mention.threadTs || mention.messageTs,
  };
  const _id = threadKey(identity);
  try {
    await collection().updateOne(
      { _id, status: { $ne: "selected" } },
      {
        $set: {
          ...identity,
          status: "pending",
          selectionId: randomUUID(),
          mention,
          choices,
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
    throw new Error("Could not save the Slack organization choices.");
  return thread;
}

export async function consumeSlackOrganizationSelection(
  selection: SlackOrganizationSelection,
  currentLinkId: string,
): Promise<SlackAssistantMention | null> {
  const identity = {
    teamId: selection.teamId,
    channelId: selection.channelId,
    rootTs: selection.threadTs,
  };
  const pending = await getSlackThread(identity);
  if (
    !pending ||
    pending.status !== "pending" ||
    pending.selectionId !== selection.selectionId ||
    pending.mention.slackUserId !== selection.slackUserId ||
    !pending.choices.some(
      (c) =>
        c.organizationId === selection.organizationId &&
        c.linkId === currentLinkId,
    )
  )
    return null;
  const result = await collection().updateOne(
    { _id: pending._id, status: "pending", selectionId: selection.selectionId },
    {
      $set: {
        status: "selected",
        organizationId: selection.organizationId,
        dateUpdated: new Date(),
      },
      $unset: { selectionId: "", mention: "", choices: "" },
    },
  );
  return result.matchedCount === 1 ? pending.mention : null;
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

export function slackOrganizationPickerBlocks(
  thread: Extract<SlackThread, { status: "pending" }>,
) {
  const options = thread.choices.map((choice) => ({
    text: {
      type: "plain_text",
      text: choice.name.slice(0, 75) || choice.organizationId,
    },
    value: JSON.stringify({
      s: thread.selectionId,
      o: choice.organizationId,
      t: thread.rootTs,
    }),
  }));
  const groups = Array.from(
    { length: Math.ceil(options.length / 100) },
    (value, i) => ({
      label: {
        type: "plain_text",
        text: `Organizations ${i * 100 + 1}-${Math.min((i + 1) * 100, options.length)}`,
      },
      options: options.slice(i * 100, (i + 1) * 100),
    }),
  );
  const rememberHint = isSlackDirectMessageChannel(thread.channelId)
    ? ' After you choose, send "remember organization" in this thread to use it for your future direct messages.'
    : "";
  return [
    {
      type: "section",
      text: {
        type: "plain_text",
        text: `Choose the GrowthBook organization for this thread. I'll continue your question there.${rememberHint}`,
      },
      accessory: {
        type: "static_select",
        action_id: "gb_select_organization",
        placeholder: { type: "plain_text", text: "Choose an organization" },
        ...(options.length <= 100 ? { options } : { option_groups: groups }),
      },
    },
  ];
}
