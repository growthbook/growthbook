import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getCollection } from "back-end/src/util/mongo.util";
import {
  buildSlackLinkUrl,
  verifySlackLinkState,
} from "back-end/src/services/slack/slackLink";
import {
  SlackAssistantMention,
  slackAssistantMentionSchema,
} from "back-end/src/services/slack/slackThreadRouting";
import { slackTaskKey } from "back-end/src/services/slack/slackTaskSafety";
import {
  deleteSlackEphemeralMessage,
  postSlackEphemeralMessage,
  slackResponseUrlSchema,
} from "back-end/src/services/slack/slackWebApi";

const RESUME_WINDOW_MS = 10 * 60 * 1000;
const requestSchema = z.object({
  _id: z.string(),
  mention: slackAssistantMentionSchema,
  organizationId: z.string().nullable(),
  resumeUntil: z.date().nullable(),
  expiresAt: z.date(),
  responseUrl: slackResponseUrlSchema.nullable(),
  linkedAccount: z
    .object({
      organizationId: z.string(),
      userId: z.string(),
      linkId: z.string(),
    })
    .nullable(),
});
type SlackLinkRequest = z.infer<typeof requestSchema>;
// Like thread routing, these records precede organization consent and are bound
// to a signed Slack identity rather than an already-authorized BaseModel context.
const collection = () => getCollection<SlackLinkRequest>("slacklinkrequests");
let expiryIndex: Promise<string> | null = null;

export async function postSlackAccountLink({
  mention,
  token,
  text,
  organizationId = null,
  resumeQuestion = false,
}: {
  mention: SlackAssistantMention;
  token: string;
  text: string;
  organizationId?: string | null;
  resumeQuestion?: boolean;
}): Promise<boolean> {
  expiryIndex ??= collection()
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    .catch((error: unknown) => {
      expiryIndex = null;
      throw error;
    });
  await expiryIndex;
  const nonce = randomBytes(12).toString("base64url");
  const url = buildSlackLinkUrl({
    slackTeamId: mention.teamId,
    slackUserId: mention.slackUserId,
    nonce,
  });
  await collection().insertOne({
    _id: nonce,
    mention,
    organizationId,
    resumeUntil: resumeQuestion
      ? new Date(Date.now() + RESUME_WINDOW_MS)
      : null,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    responseUrl: null,
    linkedAccount: null,
  });
  const message = resumeQuestion
    ? `${text} Link within 10 minutes and I'll continue your question here.`
    : text;
  return postSlackEphemeralMessage({
    token,
    channel: mention.channelId,
    user: mention.slackUserId,
    threadTs: mention.threadTs,
    text: message,
    blocks: [
      { type: "section", text: { type: "plain_text", text: message } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "gb_link_account",
            text: { type: "plain_text", text: "Link my account" },
            url,
            value: nonce,
          },
        ],
      },
    ],
  });
}

export async function dismissSlackLinkPrompt(
  request: SlackLinkRequest,
): Promise<void> {
  if (
    request.linkedAccount &&
    request.responseUrl &&
    (await deleteSlackEphemeralMessage(request.responseUrl))
  ) {
    await collection().updateOne(
      { _id: request._id, responseUrl: request.responseUrl },
      { $set: { responseUrl: null } },
    );
  }
}

export const slackLinkInteractionSchema = z.object({
  nonce: z.string().min(1),
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  slackUserId: z.string().min(1),
  responseUrl: slackResponseUrlSchema,
});

export async function captureSlackLinkInteraction(
  input: z.infer<typeof slackLinkInteractionSchema>,
): Promise<void> {
  const { nonce, teamId, channelId, slackUserId, responseUrl } =
    slackLinkInteractionSchema.parse(input);
  const result = await collection().findOneAndUpdate(
    {
      _id: nonce,
      "mention.teamId": teamId,
      "mention.channelId": channelId,
      "mention.slackUserId": slackUserId,
      expiresAt: { $gt: new Date() },
    },
    { $set: { responseUrl } },
    { returnDocument: "after" },
  );
  // The browser can finish linking before Slack delivers the button callback.
  if (result.value)
    await dismissSlackLinkPrompt(requestSchema.parse(result.value));
}

export async function completeSlackLinkRequest({
  state,
  organizationId,
  userId,
}: {
  state: string;
  organizationId: string;
  userId: string;
}): Promise<SlackLinkRequest | null> {
  const proof = verifySlackLinkState(state);
  if (!proof) return null;
  const query = {
    _id: proof.nonce,
    "mention.teamId": proof.slackTeamId,
    "mention.slackUserId": proof.slackUserId,
    expiresAt: { $gt: new Date() },
    $or: [{ organizationId: null }, { organizationId }],
  };
  const linkedAccount = {
    organizationId,
    userId,
    linkId: slackTaskKey([proof.nonce, organizationId]),
  };
  const result = await collection().findOneAndUpdate(
    { ...query, linkedAccount: null },
    { $set: { linkedAccount } },
    { returnDocument: "after" },
  );
  // Retain completion for retries: the durable queue deduplicates the question.
  const doc =
    result.value ?? (await collection().findOne({ ...query, linkedAccount }));
  return doc ? requestSchema.parse(doc) : null;
}
