import type { FeatureDigestData } from "back-end/src/services/notificationCards/featureDigestData";

type SlackBlock = Record<string, unknown>;

export interface SlackDigestMessage {
  text: string;
  blocks: SlackBlock[];
}

const flagList = (flags: string[]): string =>
  flags.map((flag) => `\`${flag}\``).join(", ");

export function buildSlackFeatureDigestMessage(
  data: FeatureDigestData,
): SlackDigestMessage {
  const counts = data.counts;
  const summaryParts: string[] = [];
  if (counts.published) summaryParts.push(`*${counts.published}* published`);
  if (counts.reverted) summaryParts.push(`*${counts.reverted}* reverted`);
  const safeRolloutTotal =
    counts.safeRolloutShipped +
    counts.safeRolloutRolledBack +
    counts.safeRolloutUnhealthy;
  if (safeRolloutTotal) {
    summaryParts.push(`*${safeRolloutTotal}* safe-rollout updates`);
  }
  if (counts.reviewRequested) {
    summaryParts.push(`*${counts.reviewRequested}* to review`);
  }
  if (counts.stale) summaryParts.push(`*${counts.stale}* stale`);

  const lines: string[] = [];
  if (data.publishedFlags.length) {
    lines.push(`:rocket: *Published:* ${flagList(data.publishedFlags)}`);
  }
  if (data.revertedFlags.length) {
    lines.push(`:rewind: *Reverted:* ${flagList(data.revertedFlags)}`);
  }
  if (data.needsAttentionFlags.length) {
    lines.push(
      `:warning: *Needs attention:* ${flagList(
        data.needsAttentionFlags.map((flag) => flag.key),
      )}`,
    );
  }
  if (
    counts.reviewRequested ||
    counts.reviewApproved ||
    counts.changesRequested
  ) {
    lines.push(
      `:eyes: *Reviews:* ${counts.reviewRequested} requested · ${counts.reviewApproved} approved · ${counts.changesRequested} changes requested`,
    );
  }

  const headerText = `Feature flag digest · ${data.period}`;
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: headerText, emoji: true },
    },
  ];
  if (summaryParts.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: summaryParts.join("  ·  ") },
    });
  }
  if (lines.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    });
  }

  return { text: headerText, blocks };
}
