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
  if (!experimentLinks.length) return;

  // Unfurl respects the sharer's permissions — resolve their linked account and
  // render only what they can see. Unlinked / non-member → don't unfurl (no
  // data leak, and no nagging on link shares).
  const target = await resolveSlackAssistantTarget({
    teamId: evt.teamId,
    channelId: evt.channelId,
    slackUserId: evt.slackUserId,
  });
  if (!target.ok) return;

  const unfurls: Record<string, { blocks: Record<string, unknown>[] }> = {};
  for (const { url, experimentId } of experimentLinks) {
    try {
      const card = await buildExperimentCardData(target.context, experimentId);
      if (!card) continue;
      const png = await renderExperimentCard(card);
      const imageUrl = await uploadCardPng(target.organizationId, png);
      if (!imageUrl) continue; // no Slack-fetchable URL (needs S3/GCS or the dev host)
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
  await unfurlSlackLinks({
    token: target.botToken,
    channel: evt.channelId,
    ts: evt.messageTs,
    unfurls,
  });
}
