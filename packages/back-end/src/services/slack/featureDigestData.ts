import { EventModel } from "back-end/src/models/EventModel";
import {
  digestEventPassesFilters,
  type SlackDigestFilters,
} from "back-end/src/services/slack/scorecardData";
import type {
  FeatureDigestData,
  FeatureDigestReason,
} from "back-end/src/services/slack/chartImage";

export type { FeatureDigestData } from "back-end/src/services/slack/chartImage";

// Feature-flag digest: flag activity over a trailing window (published,
// reverted, safe-rollout outcomes, stale candidates, reviews). Scoped by the
// channel's project/tag/feature-id filters (metric filtering stays a
// live-notification concern).

// Digest-worthy feature events and the bucket each lands in.
const PUBLISHED = "feature.revision.published";
const REVERTED = "feature.revision.reverted";
const SR_SHIP = "feature.saferollout.ship";
const SR_ROLLBACK = "feature.saferollout.rollback";
const SR_UNHEALTHY = "feature.saferollout.unhealthy";
const STALE = "feature.stale.candidate";
const REVIEW_REQUESTED = "feature.revision.reviewRequested";
const REVIEW_APPROVED = "feature.revision.approved";
const CHANGES_REQUESTED = "feature.revision.changesRequested";

const DIGEST_EVENTS = [
  PUBLISHED,
  REVERTED,
  SR_SHIP,
  SR_ROLLBACK,
  SR_UNHEALTHY,
  STALE,
  REVIEW_REQUESTED,
  REVIEW_APPROVED,
  CHANGES_REQUESTED,
];

const MAX_NOTABLE = 6;

// Most-severe-first, so a flag with several issues shows its worst reason.
const REASON_SEVERITY: Record<FeatureDigestReason, number> = {
  unhealthy: 0,
  rollback: 1,
  changes: 2,
  review: 3,
  stale: 4,
};

// Build the feature-flag digest model for an org over the trailing `windowMs`.
// Returns null when there's no activity worth reporting.
export async function buildFeatureDigestData(
  organizationId: string,
  now: Date,
  windowMs: number,
  period: string,
  filters: SlackDigestFilters,
): Promise<FeatureDigestData | null> {
  const since = new Date(now.getTime() - windowMs);

  const allEvents = await EventModel.find({
    organizationId,
    object: "feature",
    event: { $in: DIGEST_EVENTS },
    dateCreated: { $gte: since },
  })
    .sort({ dateCreated: -1 })
    .limit(1000)
    .lean<{ event: string; objectId?: string; data?: unknown }[]>();

  // Apply the channel's Scope filters (project/tag/feature-id) so a scoped
  // channel gets a scoped digest, consistent with per-event delivery.
  const events = allEvents.filter((ev) =>
    digestEventPassesFilters(ev, filters),
  );

  if (!events.length) return null;

  const counts = {
    published: 0,
    reverted: 0,
    safeRolloutShipped: 0,
    safeRolloutRolledBack: 0,
    safeRolloutUnhealthy: 0,
    stale: 0,
    reviewRequested: 0,
    reviewApproved: 0,
    changesRequested: 0,
  };
  const published = new Set<string>();
  const reverted = new Set<string>();
  // Needs-attention flags carry a reason; keep first-seen (most-recent) order
  // but upgrade to the most severe reason if a flag has several issues.
  const attentionReason = new Map<string, FeatureDigestReason>();
  const attentionOrder: string[] = [];
  const addAttention = (
    flag: string | undefined,
    reason: FeatureDigestReason,
  ) => {
    if (!flag) return;
    const existing = attentionReason.get(flag);
    if (existing === undefined) {
      attentionReason.set(flag, reason);
      attentionOrder.push(flag);
    } else if (REASON_SEVERITY[reason] < REASON_SEVERITY[existing]) {
      attentionReason.set(flag, reason);
    }
  };

  for (const ev of events) {
    const flag = ev.objectId;
    switch (ev.event) {
      case PUBLISHED:
        counts.published++;
        if (flag) published.add(flag);
        break;
      case REVERTED:
        counts.reverted++;
        if (flag) reverted.add(flag);
        break;
      case SR_SHIP:
        counts.safeRolloutShipped++;
        break;
      case SR_ROLLBACK:
        counts.safeRolloutRolledBack++;
        addAttention(flag, "rollback");
        break;
      case SR_UNHEALTHY:
        counts.safeRolloutUnhealthy++;
        addAttention(flag, "unhealthy");
        break;
      case STALE:
        counts.stale++;
        addAttention(flag, "stale");
        break;
      case REVIEW_REQUESTED:
        counts.reviewRequested++;
        addAttention(flag, "review");
        break;
      case REVIEW_APPROVED:
        counts.reviewApproved++;
        break;
      case CHANGES_REQUESTED:
        counts.changesRequested++;
        addAttention(flag, "changes");
        break;
    }
  }

  return {
    period,
    counts,
    publishedFlags: [...published].slice(0, MAX_NOTABLE),
    revertedFlags: [...reverted].slice(0, MAX_NOTABLE),
    needsAttentionFlags: attentionOrder
      .slice(0, MAX_NOTABLE)
      .map((key) => ({ key, reason: attentionReason.get(key) })),
    total: events.length,
  };
}

type SlackBlock = Record<string, unknown>;
export interface SlackDigestMessage {
  text: string;
  blocks: SlackBlock[];
}

const flagList = (flags: string[]): string =>
  flags.map((f) => `\`${f}\``).join(", ");

// Render the feature digest as a plain Slack message (mrkdwn blocks) — a
// change-log, distinct from the experiment scorecard image.
export function buildFeatureDigestMessage(
  data: FeatureDigestData,
): SlackDigestMessage {
  const c = data.counts;
  const summaryParts: string[] = [];
  if (c.published) summaryParts.push(`*${c.published}* published`);
  if (c.reverted) summaryParts.push(`*${c.reverted}* reverted`);
  const srTotal =
    c.safeRolloutShipped + c.safeRolloutRolledBack + c.safeRolloutUnhealthy;
  if (srTotal) summaryParts.push(`*${srTotal}* safe-rollout updates`);
  if (c.reviewRequested) summaryParts.push(`*${c.reviewRequested}* to review`);
  if (c.stale) summaryParts.push(`*${c.stale}* stale`);

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
        data.needsAttentionFlags.map((f) => f.key),
      )}`,
    );
  }
  if (c.reviewRequested || c.reviewApproved || c.changesRequested) {
    lines.push(
      `:eyes: *Reviews:* ${c.reviewRequested} requested · ${c.reviewApproved} approved · ${c.changesRequested} changes requested`,
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
