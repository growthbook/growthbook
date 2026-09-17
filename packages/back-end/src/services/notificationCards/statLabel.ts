// The stat a results row reports beside its lift: chance to win for Bayesian
// tests, the p-value for frequentist ones. One spelling for headers, hero
// captions, and Slack text.
import type { StatsEngine } from "shared/types/stats";

export const confidenceLabel = (statsEngine: StatsEngine): string =>
  statsEngine === "frequentist" ? "p-value" : "Chance to win";

const levelFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});

// Names the interval reported beside the lift, matching the app's results
// tables. A frequentist interval's level is one minus the threshold it was
// judged at, which multiplicity correction preserves by widening the interval;
// events recorded before the payload carried that threshold name the interval
// without a level. Bayesian credible intervals follow the app and report 95%.
export const intervalLabel = (
  statsEngine: StatsEngine,
  pValueThreshold?: number,
): string => {
  if (statsEngine !== "frequentist") return "95% CI";
  return pValueThreshold === undefined
    ? "95% CI"
    : `${levelFormatter.format(1 - pValueThreshold)} CI`;
};
