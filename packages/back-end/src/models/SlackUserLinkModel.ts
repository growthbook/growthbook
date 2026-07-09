import mongoose from "mongoose";

// Maps a Slack user (per workspace) to the GrowthBook user account they proved
// ownership of via the account-link flow. This replaces trusting the Slack
// profile email (which is user-settable / spoofable in non-SSO workspaces) as
// the basis for who the assistant acts as.

export type SlackUserLinkInterface = {
  slackTeamId: string;
  slackUserId: string;
  // The org the link was created from (context), for reference/audit. The
  // acting org is still resolved per-mention by channel/team routing, and the
  // linked user's membership in that org is re-checked at use time.
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
