import { z } from "zod";
import { getCollection } from "back-end/src/util/mongo.util";
import { logger } from "back-end/src/util/logger";
import { slackTaskKey } from "back-end/src/services/slack/slackTaskSafety";

export const slackUserPreferenceSchema = z.object({
  _id: z.string(),
  slackTeamId: z.string().min(1),
  slackUserId: z.string().min(1),
  defaultOrganizationId: z.string().min(1),
  dateUpdated: z.date(),
});
export type SlackUserPreference = z.infer<typeof slackUserPreferenceSchema>;
export type SlackUserIdentity = Pick<
  SlackUserPreference,
  "slackTeamId" | "slackUserId"
>;
// A default org is read before any organization is resolved, so like
// slackassistantthreads this is keyed by Slack identity instead of a BaseModel.
const collection = () =>
  getCollection<SlackUserPreference>("slackuserpreferences");
const preferenceKey = ({ slackTeamId, slackUserId }: SlackUserIdentity) =>
  slackTaskKey([slackTeamId, slackUserId]);

export async function getSlackUserPreference(
  identity: SlackUserIdentity,
): Promise<SlackUserPreference | null> {
  const doc = await collection().findOne({ _id: preferenceKey(identity) });
  if (!doc) return null;
  const parsed = slackUserPreferenceSchema.safeParse(doc);
  if (!parsed.success) {
    // A stored default is a convenience, never a gate. Answer the question with
    // the picker rather than failing the turn over an unreadable document.
    logger.warn(
      { ...identity, error: parsed.error },
      "Ignoring an unreadable Slack default organization",
    );
    return null;
  }
  return parsed.data;
}

export async function setSlackDefaultOrganization(
  identity: SlackUserIdentity,
  organizationId: string,
): Promise<void> {
  await collection().updateOne(
    { _id: preferenceKey(identity) },
    {
      $set: {
        slackTeamId: identity.slackTeamId,
        slackUserId: identity.slackUserId,
        defaultOrganizationId: organizationId,
        dateUpdated: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function clearSlackDefaultOrganization(
  identity: SlackUserIdentity,
): Promise<void> {
  await collection().deleteOne({ _id: preferenceKey(identity) });
}
