import type { ApiReqContext } from "back-end/types/api";
import { EventWebHookModel } from "back-end/src/models/EventWebhookModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import { getUserByEmail } from "back-end/src/models/UserModel";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import { getSlackUserEmail } from "back-end/src/services/slack/slackWebApi";

// Minimal shape we read off the (lean) Slack Event Webhook docs.
// `botAccessToken` is intentionally absent from the public
// EventWebHookInterface, so we read it through a narrow cast — the same way
// getSlackBotAccessTokenForWebhook does.
interface SlackWebhookDoc {
  id: string;
  organizationId: string;
  slack?: {
    channelId?: string;
    botAccessToken?: string;
  };
}

async function findSlackWebhooksByTeam(
  teamId: string | undefined,
): Promise<SlackWebhookDoc[]> {
  if (!teamId) return [];
  const docs = await EventWebHookModel.find({
    payloadType: "slack",
    "slack.teamId": teamId,
  }).lean();
  return docs as unknown as SlackWebhookDoc[];
}

const readBotToken = (w: SlackWebhookDoc): string | undefined =>
  w.slack?.botAccessToken || undefined;

/**
 * Narrow a workspace's Slack webhooks to the org candidates for a mention:
 * prefer webhooks bound to the exact channel (a connected channel belongs to
 * one org), else consider all of them, then keep one representative per org.
 * Pure so it can be unit-tested independently of the DB/Slack lookups.
 */
export function selectCandidateWebhooks<
  T extends { organizationId: string; slack?: { channelId?: string } },
>(webhooks: T[], channelId: string): T[] {
  const channelMatches = channelId
    ? webhooks.filter((w) => w.slack?.channelId === channelId)
    : [];
  const candidates = channelMatches.length ? channelMatches : webhooks;

  const byOrg = new Map<string, T>();
  for (const w of candidates) {
    if (!byOrg.has(w.organizationId)) byOrg.set(w.organizationId, w);
  }
  return [...byOrg.values()];
}

export type SlackTargetFailureReason =
  | "no_connection"
  | "no_bot_token"
  | "no_email"
  | "unknown_user"
  | "not_a_member"
  | "ambiguous_org";

export type SlackAssistantTarget =
  | {
      ok: true;
      /** Permission-scoped context for the matched user in the resolved org. */
      context: ApiReqContext;
      userId: string;
      userEmail: string;
      organizationId: string;
      eventWebHookId: string;
      /** Bot token to post replies with (the resolved org's token). */
      botToken: string;
    }
  | {
      ok: false;
      reason: SlackTargetFailureReason;
      message: string;
      /** A workspace bot token to post `message` back with, when we have one. */
      botToken?: string;
    };

/**
 * Resolve an inbound Slack mention to a single GrowthBook org + a
 * permission-scoped context for the mentioning user.
 *
 * On Cloud one Slack workspace can be connected to multiple GrowthBook orgs
 * (e.g. different channels wired to different orgs), so we can't just take the
 * first webhook for the team. We narrow deterministically:
 *
 *   1. Prefer webhooks bound to the exact channel the mention came from — a
 *      connected channel belongs to a single org, the strongest routing signal.
 *   2. Otherwise consider every webhook for the workspace.
 *   3. Keep only orgs the mentioning user is actually a member of. Membership
 *      is both the disambiguator and the hard access check — the returned
 *      context can only ever touch that org's data at that user's permissions.
 *   4. Exactly one member org → route there. Zero → refuse. More than one →
 *      refuse as ambiguous rather than guess.
 *
 * Never throws for the expected "can't route / can't link" cases — it returns a
 * user-facing `message` (and a bot token to post it with, when available).
 */
export async function resolveSlackAssistantTarget({
  teamId,
  channelId,
  slackUserId,
}: {
  teamId: string | undefined;
  channelId: string;
  slackUserId: string;
}): Promise<SlackAssistantTarget> {
  const webhooks = await findSlackWebhooksByTeam(teamId);
  if (!webhooks.length) {
    return {
      ok: false,
      reason: "no_connection",
      message: "This Slack workspace isn't connected to GrowthBook yet.",
    };
  }

  // Any of the workspace's bot tokens can look up the user and post replies —
  // they all belong to the same Slack team.
  const botToken = webhooks.map(readBotToken).find((t): t is string => !!t);
  if (!botToken) {
    return {
      ok: false,
      reason: "no_bot_token",
      message:
        "This Slack workspace isn't fully connected to GrowthBook. Ask an admin to reinstall the GrowthBook app.",
    };
  }

  const email = await getSlackUserEmail({ token: botToken, slackUserId });
  if (!email) {
    return {
      ok: false,
      reason: "no_email",
      message:
        "I couldn't read your Slack email, so I can't match you to a GrowthBook account.",
      botToken,
    };
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return {
      ok: false,
      reason: "unknown_user",
      message: `I couldn't find a GrowthBook account for ${email}. Ask an admin to invite that email to your organization.`,
      botToken,
    };
  }

  const candidates = selectCandidateWebhooks(webhooks, channelId);

  // Narrow to orgs the user belongs to.
  const memberTargets: { webhook: SlackWebhookDoc; context: ApiReqContext }[] =
    [];
  for (const webhook of candidates) {
    const org = await findOrganizationById(webhook.organizationId);
    if (!org) continue;
    const context = await getContextForUserIdInOrg(org, user.id);
    if (context) memberTargets.push({ webhook, context });
  }

  if (memberTargets.length === 0) {
    return {
      ok: false,
      reason: "not_a_member",
      message: `${email} isn't a member of the GrowthBook organization connected here.`,
      botToken,
    };
  }

  if (memberTargets.length > 1) {
    return {
      ok: false,
      reason: "ambiguous_org",
      message:
        "This Slack workspace is connected to more than one GrowthBook organization you belong to. Mention me in the channel connected to the organization you mean.",
      botToken,
    };
  }

  const [target] = memberTargets;
  if (!target) {
    // Unreachable given the length checks above; keeps the type narrow.
    return {
      ok: false,
      reason: "not_a_member",
      message: `${email} isn't a member of the GrowthBook organization connected here.`,
      botToken,
    };
  }

  return {
    ok: true,
    context: target.context,
    userId: user.id,
    userEmail: email,
    organizationId: target.webhook.organizationId,
    eventWebHookId: target.webhook.id,
    botToken: readBotToken(target.webhook) || botToken,
  };
}
