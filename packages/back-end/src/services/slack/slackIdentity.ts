import type {
  SlackWorkspaceConnectionInterface,
  SlackLinkConsent,
  SlackAccountLink,
} from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import type { Context } from "back-end/src/models/BaseModel";
import { EventWebHookModel } from "back-end/src/models/EventWebhookModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import { SlackUserLinkModel } from "back-end/src/models/SlackUserLinkModel";
import { SlackWorkspaceConnectionModel } from "back-end/src/models/SlackWorkspaceConnectionModel";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import {
  buildSlackLinkUrl,
  verifySlackLinkState,
} from "back-end/src/services/slack/slackLink";
import { decryptSlackBotToken } from "back-end/src/util/slackToken";

export function selectCandidateWorkspaces<T extends { organization: string }>(
  connections: T[],
  webhooks: {
    id: string;
    organizationId: string;
    slack?: { channelId?: string };
  }[],
  channelId: string,
): { connection: T; eventWebHookId: string | null }[] {
  const isDM = /^D[A-Z0-9]+$/.test(channelId);
  return connections.flatMap((connection) => {
    const webhook = webhooks.find(
      (w) =>
        w.organizationId === connection.organization &&
        w.slack?.channelId === channelId,
    );
    return isDM || webhook
      ? [{ connection, eventWebHookId: webhook?.id ?? null }]
      : [];
  });
}

export type SlackOrganizationChoice = {
  organizationId: string;
  name: string;
  linkId: string;
};

type ResolvedSlackTarget = {
  ok: true;
  context: ApiReqContext;
  userId: string;
  linkId: string;
  organizationId: string;
  organizationName: string;
  eventWebHookId: string | null;
  botToken: string;
  assistantEnabled: boolean;
  unfurlEnabled: boolean;
};
export type SlackAssistantTarget =
  | ResolvedSlackTarget
  | {
      ok: false;
      reason: "ambiguous_org";
      message: string;
      botToken: string;
      choices: SlackOrganizationChoice[];
    }
  | {
      ok: false;
      reason:
        | "no_connection"
        | "unconnected_channel"
        | "no_bot_token"
        | "not_linked"
        | "not_a_member"
        | "organization_unavailable"
        | "assistant_disabled";
      message: string;
      botToken?: string;
    };
export type SlackTargetFailureReason = Extract<
  SlackAssistantTarget,
  { ok: false }
>["reason"];

function botTokenFor(
  connection: SlackWorkspaceConnectionInterface,
): string | null {
  return decryptSlackBotToken(connection.encryptedBotAccessToken) || null;
}

export async function getSlackWorkspaceBotToken(
  teamId: string,
): Promise<string | null> {
  const connections =
    await SlackWorkspaceConnectionModel.dangerousGetAllForTeam(teamId);
  for (const connection of connections) {
    const token = botTokenFor(connection);
    if (token) return token;
  }
  return null;
}

export async function getSlackLinkConsent(
  context: Context,
  state: string,
): Promise<SlackLinkConsent> {
  const proof = verifySlackLinkState(state);
  if (!proof || !context.userId)
    throw new Error(
      "This link is invalid or expired. Send 'link account' to GrowthBook in Slack for a fresh link.",
    );
  const connections =
    await SlackWorkspaceConnectionModel.dangerousGetAllForTeam(
      proof.slackTeamId,
    );
  const links = await SlackUserLinkModel.dangerousFindAllBySlackIdentity({
    slackTeamId: proof.slackTeamId,
    slackUserId: proof.slackUserId,
  });
  const organizations: SlackLinkConsent["organizations"] = [];
  for (const connection of connections) {
    const org = await findOrganizationById(connection.organization);
    if (!org || !(await getContextForUserIdInOrg(org, context.userId)))
      continue;
    const link = links.find((l) => l.organization === org.id);
    organizations.push({
      id: org.id,
      name: org.name,
      linkedAccount: link
        ? link.growthbookUserId === context.userId
          ? "current"
          : "other"
        : null,
    });
  }
  return {
    slackTeamId: proof.slackTeamId,
    slackUserId: proof.slackUserId,
    teamName: connections[0]?.teamName || proof.slackTeamId,
    organizations,
  };
}

export async function getSlackAccountLinks(
  context: Context,
): Promise<SlackAccountLink[]> {
  const links = await context.models.slackUserLinks.getCurrentUserLinks();
  return Promise.all(
    links.map(async (link) => {
      const connections =
        await SlackWorkspaceConnectionModel.dangerousGetAllForTeam(
          link.slackTeamId,
        );
      return {
        slackTeamId: link.slackTeamId,
        slackUserId: link.slackUserId,
        linkId: link.linkId,
        teamName:
          connections.find((c) => c.organization === context.org.id)
            ?.teamName || link.slackTeamId,
      };
    }),
  );
}

/** A selected org is an exact constraint, never a preference or fallback. */
export async function resolveSlackAssistantTarget({
  teamId,
  channelId,
  slackUserId,
  organizationId,
  requireAssistantEnabled = false,
}: {
  teamId: string | undefined;
  channelId: string;
  slackUserId: string;
  organizationId?: string;
  requireAssistantEnabled?: boolean;
}): Promise<SlackAssistantTarget> {
  const connections = teamId
    ? await SlackWorkspaceConnectionModel.dangerousGetAllForTeam(teamId)
    : [];
  if (!connections.length)
    return {
      ok: false,
      reason: "no_connection",
      message: "This Slack workspace isn't connected to GrowthBook yet.",
    };
  const botToken =
    connections.map(botTokenFor).find((token) => !!token) ?? null;
  if (!botToken)
    return {
      ok: false,
      reason: "no_bot_token",
      message:
        "This Slack workspace isn't fully connected to GrowthBook. Ask an admin to reinstall the GrowthBook app.",
    };
  const webhooks = /^D[A-Z0-9]+$/.test(channelId)
    ? []
    : await EventWebHookModel.find({
        payloadType: "slack",
        "slack.teamId": teamId,
        "slack.channelId": channelId,
      }).lean();
  const candidates = selectCandidateWorkspaces(
    connections,
    webhooks,
    channelId,
  );
  if (!candidates.length)
    return {
      ok: false,
      reason: "unconnected_channel",
      message:
        "This Slack channel is not connected to GrowthBook. Use a connected channel or send me a direct message.",
      botToken,
    };
  const links = await SlackUserLinkModel.dangerousFindAllBySlackIdentity({
    slackTeamId: teamId || "",
    slackUserId,
  });
  const targets: ResolvedSlackTarget[] = [];
  let hasLink = false;
  let hasDisabledAssistant = false;
  for (const { connection, eventWebHookId } of candidates) {
    if (organizationId && connection.organization !== organizationId) continue;
    const link = links.find((l) => l.organization === connection.organization);
    if (!link) continue;
    hasLink = true;
    const org = await findOrganizationById(connection.organization);
    if (!org) continue;
    const context = await getContextForUserIdInOrg(org, link.growthbookUserId);
    const token = botTokenFor(connection);
    if (!context || !token) continue;
    // A pinned org stays pinned even if disabled; callers explain that state.
    if (
      requireAssistantEnabled &&
      !organizationId &&
      !connection.assistantEnabled
    ) {
      hasDisabledAssistant = true;
      continue;
    }
    targets.push({
      ok: true,
      context,
      userId: link.growthbookUserId,
      linkId: link.linkId,
      organizationId: org.id,
      organizationName: org.name,
      eventWebHookId,
      botToken: token,
      assistantEnabled: connection.assistantEnabled === true,
      unfurlEnabled: connection.unfurlEnabled === true,
    });
  }
  if (targets.length === 1) return targets[0];
  if (targets.length > 1)
    return {
      ok: false,
      reason: "ambiguous_org",
      botToken,
      message: "Choose the GrowthBook organization for this thread.",
      choices: targets.map((t) => ({
        organizationId: t.organizationId,
        name: t.organizationName,
        linkId: t.linkId,
      })),
    };
  if (organizationId)
    return {
      ok: false,
      reason: "organization_unavailable",
      botToken,
      message:
        "This thread's GrowthBook organization is no longer available to your linked account. Restore your access or start a new thread. To link this organization, send 'link account' to GrowthBook in Slack.",
    };
  if (hasDisabledAssistant)
    return {
      ok: false,
      reason: "assistant_disabled",
      botToken,
      message:
        "The GrowthBook assistant is turned off in your linked organizations. An admin can turn it on in GrowthBook → Integrations → Slack.",
    };
  return hasLink
    ? {
        ok: false,
        reason: "not_a_member",
        botToken,
        message:
          "Your linked GrowthBook account no longer has access to the connected organization.",
      }
    : {
        ok: false,
        reason: "not_linked",
        botToken,
        message:
          "Link your Slack account to the GrowthBook organization you want to use: " +
          buildSlackLinkUrl({ slackTeamId: teamId || "", slackUserId }),
      };
}
