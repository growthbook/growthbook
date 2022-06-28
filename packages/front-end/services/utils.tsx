import { ExperimentPhaseStringDates } from "back-end/types/experiment";
import { UserRef } from "back-end/types/user";
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

export function getOwnerByUserRef(userRef: UserRef | undefined) {
  if (!userRef) return undefined;
  if (userRef === undefined) return undefined;
  if (userRef.name) return userRef.name;
  if (userRef.email) return userRef.email;
  return undefined;
}
