import { ExperimentPhaseStringDates } from "back-end/types/experiment";
import React from "react";

export function formatTrafficSplit(weights: number[]): string {
  return weights
    .map((w, i) => (i ? Math.floor(w * 100) : Math.ceil(w * 100)))
    .join("/");
}

export function phaseSummaryText(phase: ExperimentPhaseStringDates): string {
  return `${phase.phase === "main" ? "" : phase.phase + ", "}${Math.floor(
    phase.coverage * 100
  )}% traffic, ${formatTrafficSplit(phase.variationWeights)} split`;
}

export function phaseSummary(
  phase: ExperimentPhaseStringDates
): React.ReactElement {
  return (
    <>
      <span className="phase">
        {phase.phase === "main" ? "" : phase.phase + ", "}
      </span>
      <span className="percent-traffic">
        {Math.floor(phase.coverage * 100)}%
      </span>{" "}
      traffic,{" "}
      <span className="split">
        {formatTrafficSplit(phase.variationWeights)}
      </span>{" "}
      split
    </>
  );
}

export function getEvenSplit(n: number) {
  const weights = [];
  const equal = 100 / n;

  for (let i = 0; i < n; i++) {
    weights.push((i > 0 ? Math.floor(equal) : Math.ceil(equal)) / 100);
  }

  return weights;
}
