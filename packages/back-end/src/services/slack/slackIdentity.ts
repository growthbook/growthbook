import type {
  SlackWorkspaceConnectionInterface,
  SlackLinkConsent,
  SlackAccountLink,
} from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import type { Context } from "back-end/src/models/BaseModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import { SlackUserLinkModel } from "back-end/src/models/SlackUserLinkModel";
import { SlackWorkspaceConnectionModel } from "back-end/src/models/SlackWorkspaceConnectionModel";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import { verifySlackLinkState } from "back-end/src/services/slack/slackLink";
import { decryptSlackBotToken } from "back-end/src/util/slackToken";

export type ResolvedSlackTarget = {
  ok: true;
  context: ApiReqContext;
  userId: string;
  linkId: string;
  organizationId: string;
  botToken: string;
};
export type SlackAssistantTarget =
  | ResolvedSlackTarget
  | {
      ok: false;
      reason: "not_linked";
      organizationId: string;
      message: string;
      botToken: string;
    }
  | {
      ok: false;
      reason:
        | "no_connection"
        | "no_bot_token"
        | "not_a_member"
        | "organization_unavailable"
        | "assistant_disabled";
      message: string;
      botToken?: string;
    };
function botTokenFor(
  connection: SlackWorkspaceConnectionInterface,
): string | null {
  return decryptSlackBotToken(connection.encryptedBotAccessToken) || null;
}

export async function getSlackWorkspaceBotToken(
  teamId: string,
): Promise<string | null> {
  const connection =
    await SlackWorkspaceConnectionModel.dangerousGetForTeam(teamId);
  return connection ? botTokenFor(connection) : null;
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
  const connection = await SlackWorkspaceConnectionModel.dangerousGetForTeam(
    proof.slackTeamId,
  );
  if (!connection || connection.organization !== context.org.id) {
    throw new Error(
      "This Slack workspace is not connected to the selected GrowthBook organization. Switch to the connected organization to link your account.",
    );
  }
  const org = await findOrganizationById(connection.organization);
  if (!org || !(await getContextForUserIdInOrg(org, context.userId))) {
    throw new Error(
      "Your account no longer has access to the GrowthBook organization connected to this Slack workspace.",
    );
  }
  const links = await SlackUserLinkModel.dangerousFindAllBySlackIdentity({
    slackTeamId: proof.slackTeamId,
    slackUserId: proof.slackUserId,
  });
  const link = links.find((l) => l.organization === org.id);
  return {
    slackTeamId: proof.slackTeamId,
    slackUserId: proof.slackUserId,
    teamName: connection.teamName || proof.slackTeamId,
    organization: {
      id: org.id,
      name: org.name,
      linkedAccount: link
        ? link.growthbookUserId === context.userId
          ? "current"
          : "other"
        : null,
    },
  };
}

export async function getSlackAccountLinks(
  context: Context,
): Promise<SlackAccountLink[]> {
  const links = await context.models.slackUserLinks.getCurrentUserLinks();
  return Promise.all(
    links.map(async (link) => {
      const connection =
        await SlackWorkspaceConnectionModel.dangerousGetForTeam(
          link.slackTeamId,
        );
      return {
        slackTeamId: link.slackTeamId,
        slackUserId: link.slackUserId,
        linkId: link.linkId,
        teamName: connection?.teamName || link.slackTeamId,
      };
    }),
  );
}

/** A pinned org is an exact constraint, never a preference or fallback. */
export async function resolveSlackAssistantTarget({
  teamId,
  slackUserId,
  organizationId,
  requireAssistantEnabled = false,
}: {
  teamId: string | undefined;
  slackUserId: string;
  organizationId?: string;
  requireAssistantEnabled?: boolean;
}): Promise<SlackAssistantTarget> {
  const connection = teamId
    ? await SlackWorkspaceConnectionModel.dangerousGetForTeam(teamId)
    : null;
  if (!connection)
    return {
      ok: false,
      reason: "no_connection",
      message: "This Slack workspace isn't connected to GrowthBook yet.",
    };
  const botToken = botTokenFor(connection);
  if (!botToken)
    return {
      ok: false,
      reason: "no_bot_token",
      message:
        "This Slack workspace isn't fully connected to GrowthBook. Ask an admin to reinstall the GrowthBook app.",
    };
  if (organizationId && organizationId !== connection.organization)
    return {
      ok: false,
      reason: "organization_unavailable",
      botToken,
      message:
        "This thread's GrowthBook organization is no longer connected to this Slack workspace. Start a new thread.",
    };
  const links = await SlackUserLinkModel.dangerousFindAllBySlackIdentity({
    slackTeamId: connection.teamId,
    slackUserId,
  });
  const link = links.find((l) => l.organization === connection.organization);
  if (!link)
    return {
      ok: false,
      reason: "not_linked",
      organizationId: connection.organization,
      botToken,
      message:
        "Link your Slack account to the GrowthBook organization connected to this workspace.",
    };
  const org = await findOrganizationById(connection.organization);
  const context = org
    ? await getContextForUserIdInOrg(org, link.growthbookUserId)
    : null;
  if (!context)
    return {
      ok: false,
      reason: "not_a_member",
      botToken,
      message:
        "Your linked GrowthBook account no longer has access to the connected organization.",
    };
  if (requireAssistantEnabled && connection.assistantEnabled === false)
    return {
      ok: false,
      reason: "assistant_disabled",
      botToken,
      message:
        "The GrowthBook assistant is turned off for this workspace. An admin can turn it on in GrowthBook → Integrations → Slack.",
    };
  return {
    ok: true,
    context,
    userId: link.growthbookUserId,
    linkId: link.linkId,
    organizationId: connection.organization,
    botToken,
  };
}
