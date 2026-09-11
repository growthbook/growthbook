import {
  FeatureDigestData,
  FeatureDigestReason,
  ScorecardData,
  ScorecardNotable,
  renderFeatureDigest,
  renderWeeklyScorecard,
} from "./cardImages";

type DigestImageEvent = { event?: string; objectId?: string; data?: unknown };
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const identity = (event: DigestImageEvent) => {
  const envelope = record(event.data);
  const data = record(envelope.data ?? envelope);
  const object = record(data.object);
  const key = [
    object.experimentId,
    object.featureId,
    object.id,
    event.objectId,
  ].find((value) => typeof value === "string" && value.length);
  const name = [object.experimentName, object.name, key].find(
    (value) => typeof value === "string" && value.length,
  );
  return {
    key: typeof key === "string" ? key : null,
    name: String(name || "Unnamed").slice(0, 100),
  };
};

export function digestRangeLabel(start: Date, end: Date): string {
  const format = (date: Date) =>
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${format(start)} – ${format(end)} (UTC)`;
}

// Call add only after destination filters and snoozes have been applied.
// Counts are event occurrences; bounded lists hold the most recent examples.
export function createDigestImageData(period: string) {
  const scorecard: ScorecardData = {
    week: period,
    stats: { started: 0, significant: 0, stopped: 0, warnings: 0 },
    notable: [],
  };
  const feature: FeatureDigestData = {
    period,
    total: 0,
    counts: {
      published: 0,
      reverted: 0,
      safeRolloutShipped: 0,
      safeRolloutRolledBack: 0,
      safeRolloutUnhealthy: 0,
      stale: 0,
      reviewRequested: 0,
      reviewApproved: 0,
      changesRequested: 0,
    },
    publishedFlags: [],
    revertedFlags: [],
    needsAttentionFlags: [],
  };
  const notableKeys = new Set<string>();
  const addKey = (list: string[], key: string) => {
    if (list.length < 6 && !list.includes(key)) list.push(key);
  };
  const attention = (key: string, reason: FeatureDigestReason) => {
    if (
      feature.needsAttentionFlags.length < 6 &&
      !feature.needsAttentionFlags.some((flag) => flag.key === key)
    )
      feature.needsAttentionFlags.push({ key, reason });
  };
  const add = (event: DigestImageEvent) => {
    const { key, name } = identity(event);
    const eventName = event.event || "";
    let notable: ScorecardNotable | null = null;
    if (eventName === "experiment.started") {
      scorecard.stats.started++;
      notable = { name, state: "started", note: "Started" };
    } else if (eventName === "experiment.stopped") {
      scorecard.stats.stopped++;
      notable = { name, state: "stopped", note: "Stopped" };
    } else if (eventName === "experiment.info.significance") {
      scorecard.stats.significant++;
      notable = {
        name,
        state: "running",
        label: "Significant",
        note: "Significance event",
      };
    } else if (
      eventName === "experiment.warning" ||
      eventName === "experiment.health.guardrailFailed" ||
      eventName === "experiment.health.queryFailed" ||
      eventName === "experiment.metric.regression"
    ) {
      scorecard.stats.warnings++;
      notable = {
        name,
        state: "warning",
        label: "Warning",
        note: "Warning event",
      };
    } else if (eventName.startsWith("experiment.")) {
      notable = { name, state: "running", label: "Updated", note: "Updated" };
    }
    if (
      notable &&
      scorecard.notable.length < 8 &&
      (!key || !notableKeys.has(key))
    ) {
      scorecard.notable.push(notable);
      if (key) notableKeys.add(key);
    }
    if (!eventName.startsWith("feature.")) return;
    feature.total++;
    switch (eventName) {
      case "feature.revision.published":
        feature.counts.published++;
        if (key) addKey(feature.publishedFlags, key);
        break;
      case "feature.revision.reverted":
        feature.counts.reverted++;
        if (key) addKey(feature.revertedFlags, key);
        break;
      case "feature.saferollout.ship":
        feature.counts.safeRolloutShipped++;
        break;
      case "feature.saferollout.rollback":
        feature.counts.safeRolloutRolledBack++;
        if (key) attention(key, "rollback");
        break;
      case "feature.saferollout.unhealthy":
        feature.counts.safeRolloutUnhealthy++;
        if (key) attention(key, "unhealthy");
        break;
      case "feature.stale.candidate":
        feature.counts.stale++;
        if (key) attention(key, "stale");
        break;
      case "feature.revision.reviewRequested":
        feature.counts.reviewRequested++;
        if (key) attention(key, "review");
        break;
      case "feature.revision.approved":
        feature.counts.reviewApproved++;
        break;
      case "feature.revision.changesRequested":
        feature.counts.changesRequested++;
        if (key) attention(key, "changes");
        break;
    }
  };
  return {
    add,
    scorecard,
    feature,
    render: (kind: "experiment" | "feature") =>
      kind === "experiment"
        ? renderWeeklyScorecard(scorecard)
        : renderFeatureDigest(feature),
  };
}
