import type { ApiReqContext } from "back-end/types/api";
import {
  EventWebHookModel,
  getSlackBotAccessTokenForWebhook,
} from "back-end/src/models/EventWebhookModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import { getUserByEmail } from "back-end/src/models/UserModel";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import { getSlackUserEmail } from "back-end/src/services/slack/slackWebApi";

/**
 * Find the Slack-payload Event Webhook that connects a Slack team (workspace)
 * to a GrowthBook org. This is the anchor that maps an inbound Slack event to
 * an organization and to the bot token used to reply.
 */
export async function findSlackWebhookByTeam(teamId: string | undefined) {
  if (!teamId) return null;
  return EventWebHookModel.findOne({
    payloadType: "slack",
    "slack.teamId": teamId,
  }).lean();
}

export type SlackIdentityFailureReason =
  | "no_bot_token"
  | "no_email"
  | "unknown_user"
  | "not_a_member";

export type SlackIdentity =
  | {
      ok: true;
      /** Permission-scoped context for the matched GrowthBook user. */
      context: ApiReqContext;
      userId: string;
      userEmail: string;
    }
  | { ok: false; reason: SlackIdentityFailureReason; message: string };

/**
 * Map a Slack user to a permission-scoped GrowthBook context.
 *
 * Slack user id → email (via users.info, using the workspace's stored bot
 * token) → GrowthBook user → org-membership-scoped context. The returned
 * context carries exactly the matched user's permissions, so the assistant can
 * never read or change anything the user couldn't in the app.
 *
 * On any failure it returns a user-facing `message` the caller can post back
 * to Slack — never throws for the expected "can't link this person" cases.
 */
export async function resolveSlackUserContext({
  eventWebHookId,
  organizationId,
  slackUserId,
}: {
  eventWebHookId: string;
  organizationId: string;
  slackUserId: string;
}): Promise<SlackIdentity> {
  const token = await getSlackBotAccessTokenForWebhook({
    eventWebHookId,
    organizationId,
  });
  if (!token) {
    return {
      ok: false,
      reason: "no_bot_token",
      message:
        "This Slack workspace isn't fully connected to GrowthBook. Ask an admin to reinstall the GrowthBook app.",
    };
  }

  const email = await getSlackUserEmail({ token, slackUserId });
  if (!email) {
    return {
      ok: false,
      reason: "no_email",
      message:
        "I couldn't read your Slack email, so I can't match you to a GrowthBook account.",
    };
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return {
      ok: false,
      reason: "unknown_user",
      message: `I couldn't find a GrowthBook account for ${email}. Ask an admin to invite that email to your organization.`,
    };
  }

  const org = await findOrganizationById(organizationId);
  if (!org) {
    return {
      ok: false,
      reason: "not_a_member",
      message: "This GrowthBook organization is no longer available.",
    };
  }

  // getContextForUserIdInOrg returns null when the user isn't a member of the
  // org, which is exactly the access check we want.
  const context = await getContextForUserIdInOrg(org, user.id);
  if (!context) {
    return {
      ok: false,
      reason: "not_a_member",
      message: `${email} isn't a member of this GrowthBook organization.`,
    };
  }

  return { ok: true, context, userId: user.id, userEmail: email };
}
