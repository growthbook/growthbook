// Standard NPS bands, defined once for both packages: 0-6 detractor,
// 7-8 passive, 9-10 promoter. The front-end uses these for the survey UI and
// telemetry; the back-end uses them for the Slack message, so keeping one
// definition stops the two from disagreeing on a boundary score.
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
    // Slack attachment bar colour, so sentiment reads at a glance.
    slackColor: string;
  }
> = {
  detractor: { label: "Detractor", npsValue: -1, slackColor: "#e01e5a" },
  passive: { label: "Passive", npsValue: 0, slackColor: "#ecb22e" },
  promoter: { label: "Promoter", npsValue: 1, slackColor: "#2eb67d" },
};

export function npsValueOf(score: number): number {
  return NPS_CATEGORY_META[npsCategoryOf(score)].npsValue;
}
