import { logger } from "back-end/src/util/logger";
import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";
import { buildExperimentCardData } from "back-end/src/services/slack/experimentCardData";
import { unfurlSlackLinks } from "back-end/src/services/slack/slackWebApi";

// Unfurl GrowthBook experiment links shared in Slack into a concise text
// summary. Text-only because unfurls can't carry a private uploaded image (a
// slack_file block is rejected) and we never host results at a public URL.

const EXPERIMENT_URL_RE = /\/experiment\/([a-zA-Z0-9_-]+)/;

export interface SlackLinkShared {
  teamId: string;
  channelId: string;
  messageTs: string;
  slackUserId: string;
  links: { url?: string; domain?: string }[];
}

export async function handleSlackLinkShared(
  evt: SlackLinkShared,
): Promise<void> {
  // Only handle experiment links; ignore anything else in the message.
  const experimentLinks = evt.links
    .map((l) => ({
      url: l.url || "",
      experimentId: (l.url || "").match(EXPERIMENT_URL_RE)?.[1],
    }))
    .filter(
      (x): x is { url: string; experimentId: string } => !!x.experimentId,
    );
  if (!experimentLinks.length) {
    logger.info(
      { urls: evt.links.map((l) => l.url) },
      "Slack unfurl: no experiment links matched (nothing to unfurl)",
    );
    return;
  }

  // Unfurl respects the sharer's permissions — resolve their linked account and
  // render only what they can see. Unlinked / non-member → don't unfurl (no
  // data leak, and no nagging on link shares).
  const target = await resolveSlackAssistantTarget({
    teamId: evt.teamId,
    channelId: evt.channelId,
    slackUserId: evt.slackUserId,
  });
  if (!target.ok) {
    logger.warn(
      {
        reason: target.reason,
        teamId: evt.teamId,
        slackUserId: evt.slackUserId,
      },
      "Slack unfurl: could not resolve sharer identity (is the user linked & an org member?)",
    );
    return;
  }

  // Workspace turned link previews off — leave shared links as-is.
  if (!target.unfurlEnabled) {
    logger.info(
      { organizationId: target.organizationId },
      "Slack unfurl: disabled for workspace, skipping",
    );
    return;
  }

  const unfurls: Record<string, { blocks: Record<string, unknown>[] }> = {};
  for (const { url, experimentId } of experimentLinks) {
    try {
      const card = await buildExperimentCardData(target.context, experimentId);
      if (!card) {
        logger.warn(
          { experimentId },
          "Slack unfurl: no card data (experiment not found or no results)",
        );
        continue;
      }
      const row = card.rows[0];
      const summary = [
        card.goal ? `*Goal:* ${card.goal}` : null,
        row?.chg
          ? `${row.dir === "up" ? "▲" : "▼"} ${row.chg}${
              row.ctw ? ` · ${row.ctw} chance to win` : ""
            }`
          : null,
      ]
        .filter(Boolean)
        .join("  ·  ");
      // Show the tracking key only when it differs from the name — many
      // experiments use the same string for both, which reads as a duplicate.
      const keyPart =
        card.key && card.key !== card.name ? `  \`${card.key}\`` : "";
      unfurls[url] = {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${card.name}*${keyPart}${summary ? `\n${summary}` : ""}`,
            },
          },
        ],
      };
    } catch (e) {
      logger.error(e, `Slack unfurl failed for ${experimentId}`);
    }
  }

  if (!Object.keys(unfurls).length) return;
  const ok = await unfurlSlackLinks({
    token: target.botToken,
    channel: evt.channelId,
    ts: evt.messageTs,
    unfurls,
  });
  logger.info(
    { ok, urls: Object.keys(unfurls) },
    "Slack unfurl: chat.unfurl call completed",
  );
}
