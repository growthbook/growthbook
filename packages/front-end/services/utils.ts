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

export function getEvenSplit(n: number) {
  const weights = [];
  const equal = 100 / n;

  for (let i = 0; i < n; i++) {
    weights.push((i > 0 ? Math.floor(equal) : Math.ceil(equal)) / 100);
  }

  return weights;
}

export function getApiHost(): string {
  return process.env.NEXT_PUBLIC_API_HOST || "http://localhost:3100";
}
export function isCloud(): boolean {
  return !!process.env.NEXT_PUBLIC_IS_CLOUD;
}
