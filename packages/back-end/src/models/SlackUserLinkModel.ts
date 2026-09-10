import mongoose from "mongoose";

// Maps a Slack user (per workspace) to the GrowthBook account they proved
// ownership of via the account-link flow. Basis for who the assistant acts as,
// replacing the spoofable Slack profile email (user-settable in non-SSO
// workspaces).

export type SlackUserLinkInterface = {
  slackTeamId: string;
  slackUserId: string;
  // The org the link was created from, for reference/audit only. The acting org
  // is resolved per-mention by channel/team routing, and membership re-checked
  // at use time.
  organizationId: string;
  growthbookUserId: string;
  dateCreated: Date;
  dateUpdated: Date;
};

const slackUserLinkSchema = new mongoose.Schema<SlackUserLinkInterface>({
  slackTeamId: { type: String, required: true },
  slackUserId: { type: String, required: true },
  organizationId: { type: String, required: true },
  growthbookUserId: { type: String, required: true },
  dateCreated: { type: Date, required: true },
  dateUpdated: { type: Date, required: true },
});

// One GrowthBook identity per (workspace, Slack user).
slackUserLinkSchema.index({ slackTeamId: 1, slackUserId: 1 }, { unique: true });

const SlackUserLinkModel = mongoose.model<SlackUserLinkInterface>(
  "SlackUserLink",
  slackUserLinkSchema,
);

export async function getSlackUserLink({
  slackTeamId,
  slackUserId,
}: {
  slackTeamId: string;
  slackUserId: string;
}): Promise<SlackUserLinkInterface | null> {
  return SlackUserLinkModel.findOne({ slackTeamId, slackUserId }).lean();
}

export async function upsertSlackUserLink({
  slackTeamId,
  slackUserId,
  organizationId,
  growthbookUserId,
}: {
  slackTeamId: string;
  slackUserId: string;
  organizationId: string;
  growthbookUserId: string;
}): Promise<void> {
  const now = new Date();
  await SlackUserLinkModel.updateOne(
    { slackTeamId, slackUserId },
    {
      $set: { organizationId, growthbookUserId, dateUpdated: now },
      $setOnInsert: { dateCreated: now },
    },
    { upsert: true },
  );
}
