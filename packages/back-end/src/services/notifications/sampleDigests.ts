import type { ScorecardData } from "back-end/src/services/notificationCards/digests/scorecard";
import type { FeatureDigestData } from "back-end/src/services/notificationCards/digests/featureDigest";

export function sampleScorecard(): ScorecardData {
  return {
    week: "Jul 1 – Jul 7, 2026",
    stats: { started: 8, significant: 3, stopped: 2, warnings: 1 },
    notable: [
      {
        name: "Homepage hero test",
        state: "running",
        label: "Significant",
        note: "Significance event",
      },
      { name: "Checkout v2 flow", state: "started", note: "Started" },
      { name: "Signup CTA copy", state: "stopped", note: "Stopped" },
      { name: "Pricing page layout", state: "started", note: "Started" },
      {
        name: "Mobile nav redesign",
        state: "warning",
        label: "Warning",
        note: "Warning event",
      },
      {
        name: "Email digest cadence",
        state: "running",
        label: "Updated",
        note: "Updated",
      },
    ],
  };
}

export function sampleFeatureDigest(): FeatureDigestData {
  return {
    period: "Jun 8 – Jul 8, 2026",
    total: 16,
    counts: {
      published: 7,
      reverted: 1,
      safeRolloutShipped: 2,
      safeRolloutRolledBack: 1,
      safeRolloutUnhealthy: 1,
      stale: 0,
      reviewRequested: 2,
      reviewApproved: 1,
      changesRequested: 1,
    },
    publishedFlags: [
      "checkout-banner",
      "new-nav",
      "pricing-v2",
      "signup-cta",
      "referral-widget",
    ],
    revertedFlags: ["legacy-search"],
    needsAttentionFlags: [
      { key: "promo-banner", reason: "unhealthy" },
      { key: "cart-upsell", reason: "rollback" },
      { key: "beta-dashboard", reason: "changes" },
      { key: "onboarding-tour", reason: "review" },
    ],
  };
}
