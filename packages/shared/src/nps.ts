// Standard NPS bands, defined once so the survey UI, telemetry and the Slack
// message can't disagree on a boundary score.
export type NpsCategory = "detractor" | "passive" | "promoter";

export function npsCategoryOf(score: number): NpsCategory {
  return score <= 6 ? "detractor" : score <= 8 ? "passive" : "promoter";
}

export const NPS_CATEGORY_META: Record<
  NpsCategory,
  {
    label: string;
    // NPS contribution: +1 promoter, -1 detractor, 0 passive.
    npsValue: number;
    slackColor: string;
  }
> = {
  detractor: { label: "Detractor", npsValue: -1, slackColor: "#e01e5a" },
  passive: { label: "Passive", npsValue: 0, slackColor: "#ecb22e" },
  promoter: { label: "Promoter", npsValue: 1, slackColor: "#2eb67d" },
};

// Longest comment the survey accepts, shared so the textarea cap and the Slack
// truncation can't drift. Also keeps the body clear of the ~64KB ceiling on
// `keepalive` requests, which throw before sending rather than truncating.
export const NPS_MAX_FEEDBACK_LENGTH = 1500;

export function npsValueOf(score: number): number {
  return NPS_CATEGORY_META[npsCategoryOf(score)].npsValue;
}
