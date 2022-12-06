import { ExperimentPhaseStringDates } from "back-end/types/experiment";
import React from "react";

export function formatTrafficSplit(weights: number[], decimals = 0): string {
  const sum = weights.reduce((sum, n) => sum + n, 0);
  return weights.map((w) => +((w / sum) * 100).toFixed(decimals)).join("/");
}

export function phaseSummaryText(phase: ExperimentPhaseStringDates): string {
  return `${phase.phase === "main" ? "" : phase.phase + ", "}${Math.floor(
    phase.coverage * 100
  )}% traffic, ${formatTrafficSplit(phase.variationWeights)} split`;
}

export function phaseSummary(
  phase: ExperimentPhaseStringDates
): React.ReactElement {
  if (!phase?.phase) {
    return null;
  }
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
        {formatTrafficSplit(phase.variationWeights || [])}
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

export function isNullUndefinedOrEmpty(x) {
  if (x === null) return true;
  if (x === undefined) return true;
  if (x === "") return true;
  if (typeof x === "object" && !Object.keys(x).length) return true;
  return false;
}

export function truncateText(text: string, max: number = 50) {
  if (text.length > max) {
    return text.slice(0, max) + "...";
  } else {
    return text;
  }
}
