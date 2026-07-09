import { logger } from "back-end/src/util/logger";
import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";
import { buildExperimentCardData } from "back-end/src/services/slack/experimentCardData";
import { renderExperimentCard } from "back-end/src/services/slack/cards";
import { uploadCardPng } from "back-end/src/services/slack/cardDelivery";
import { unfurlSlackLinks } from "back-end/src/services/slack/slackWebApi";

// Unfurl GrowthBook experiment links shared in Slack into a rich results card,
// reusing the same render + upload pipeline as the assistant's attachments.

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
      const png = await renderExperimentCard(card);
      const imageUrl = await uploadCardPng(target.organizationId, png);
      if (!imageUrl) {
        logger.warn(
          { experimentId },
          "Slack unfurl: no Slack-fetchable image URL — set SLACK_CARD_PUBLIC_BASE_URL (dev) or configure S3/GCS uploads",
        );
        continue;
      }
      unfurls[url] = {
        blocks: [
          {
            type: "image",
            image_url: imageUrl,
            alt_text: `${card.name} — experiment results`,
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
