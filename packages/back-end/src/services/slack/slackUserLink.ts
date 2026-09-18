import { SlackUserLinkInterface } from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import {
  getCollection,
  isDuplicateKeyError,
} from "back-end/src/util/mongo.util";
import { verifySlackLinkState } from "back-end/src/services/slack/slackLink";
import {
  claimSlackTask,
  slackTaskKey,
} from "back-end/src/services/slack/slackTaskSafety";

export const SLACK_USER_LINK_COLLECTION = "slackuserlinks";

const linkCollection = () =>
  getCollection<SlackUserLinkInterface>(SLACK_USER_LINK_COLLECTION);

export async function linkSlackUser(
  context: Context,
  state: string,
): Promise<void> {
  const proof = verifySlackLinkState(state);
  if (
    !proof ||
    !context.userId ||
    !context.org.members.some((m) => m.id === context.userId)
  ) {
    throw new Error(
      "A valid Slack consent link and signed-in account are required.",
    );
  }
  const identity = {
    slackTeamId: proof.slackTeamId,
    slackUserId: proof.slackUserId,
    organization: context.org.id,
  };
  const workspace = await getCollection("slackworkspaceconnections").findOne({
    teamId: proof.slackTeamId,
    organization: context.org.id,
  });
  if (!workspace)
    throw new Error(
      "This Slack workspace is not connected to your organization.",
    );
  const collection = linkCollection();
  const linkId = slackTaskKey([proof.nonce, identity.organization]);
  if (!(await claimSlackTask(`link:${linkId}`))) {
    const current = await collection.findOne({
      ...identity,
      growthbookUserId: context.userId,
      linkId,
    });
    if (current) return;
    throw new Error(
      "This consent link has already been used for this organization. Send 'link account' to GrowthBook in Slack for a fresh link.",
    );
  }
  const now = new Date();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await collection.updateOne(
        identity,
        {
          $set: { growthbookUserId: context.userId, linkId, dateUpdated: now },
          $setOnInsert: { dateCreated: now },
        },
        { upsert: true },
      );
      return;
    } catch (error) {
      if (!isDuplicateKeyError(error) || attempt === 2) throw error;
    }
  }
}

export async function unlinkSlackUser(
  context: Context,
  identity: Pick<
    SlackUserLinkInterface,
    "slackTeamId" | "slackUserId" | "linkId"
  >,
): Promise<boolean> {
  if (!context.userId)
    throw new Error("You must be signed in to disconnect your Slack account.");
  const collection = linkCollection();
  const query = {
    organization: context.org.id,
    growthbookUserId: context.userId,
    slackTeamId: identity.slackTeamId,
    slackUserId: identity.slackUserId,
  };
  const current = await collection.findOne(query);
  if (!current || current.linkId !== identity.linkId) return false;
  // Include the stored generation so a stale page cannot remove a replacement link.
  const result = await collection.deleteOne({
    ...query,
    linkId: current.linkId,
    dateUpdated: current.dateUpdated,
  });
  return result.deletedCount === 1;
}
