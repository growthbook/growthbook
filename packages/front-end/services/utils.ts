import { ExperimentPhaseStringDates } from "back-end/types/experiment";

export function formatTrafficSplit(weights: number[]): string {
  return weights
    .map((w, i) => (i ? Math.floor(w * 100) : Math.ceil(w * 100)))
    .join("/");
}

export function phaseSummary(phase: ExperimentPhaseStringDates): string {
  return `${phase.phase === "main" ? "" : phase.phase + ", "}${Math.floor(
    phase.coverage * 100
  )}% traffic, ${formatTrafficSplit(phase.variationWeights)} split`;
}
