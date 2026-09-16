// The stat a results row reports beside its lift: chance to win for Bayesian
// tests, the p-value for frequentist ones. One spelling for headers, hero
// captions, and Slack text.
import type { StatsEngine } from "shared/types/stats";

export const confidenceLabel = (statsEngine: StatsEngine): string =>
  statsEngine === "frequentist" ? "p-value" : "Chance to win";
