import { ExperimentPhaseStringDates } from "back-end/types/experiment";
import React, { ReactNode } from "react";
import qs from "query-string";

export function trafficSplitPercentages(weights: number[]): number[] {
  const sum = weights.reduce((sum, n) => sum + n, 0);
  return weights.map((w) => +((w / sum) * 100));
}

export function formatTrafficSplit(weights: number[], decimals = 0): string {
  return trafficSplitPercentages(weights)
    .map((w) => w.toFixed(decimals))
    .join("/");
}

// Get the number of decimals +1 needed to differentiate between
// observed and expected weights
export function getSRMNeededPrecisionP1(
  observed: number[],
  expected: number[]
): number {
  const observedpct = trafficSplitPercentages(observed);
  const expectedpct = trafficSplitPercentages(expected);
  const maxDiff = Math.max(
    ...observedpct.map((o, i) => Math.abs(o - expectedpct[i] || 0))
  );
  return (maxDiff ? -1 * Math.floor(Math.log10(maxDiff)) : 0) + 1;
}

export function phaseSummary(phase: ExperimentPhaseStringDates): ReactNode {
  if (!phase) {
    return null;
  }
  return (
    <>
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

// Returns n "equal" decimals rounded to 3 places that add up to 1
// The sum always adds to 1. In some cases the values are not equal.
// For example, getEqualWeights(3) returns [0.3334, 0.3333, 0.3333]
export function getEqualWeights(n: number, precision: number = 4): number[] {
  // The power of 10 we need to manipulate weights to the correct precision
  const multiplier = Math.pow(10, precision);

  // Naive even weighting with rounding
  // For n=3, this will result in `0.3333`
  const w = Math.round(multiplier / n) / multiplier;

  // Determine how far off we are from a sum of 1
  // For n=3, this will be 0.9999-1 = -0.0001
  const diff = w * n - 1;

  // How many of the weights do we need to add a correction to?
  // For n=3, we only have to adjust 1 of the weights to make it sum to 1
  const numCorrections = Math.round(Math.abs(diff) * multiplier);
  const delta = (diff < 0 ? 1 : -1) / multiplier;

  return (
    Array(n)
      .fill(0)
      .map((v, i) => +(w + (i < numCorrections ? delta : 0)).toFixed(precision))
      // Put the larger weights first
      .sort((a, b) => b - a)
  );
}

export function distributeWeights(
  weights: number[],
  customSplit: boolean
): number[] {
  // Always just use equal weights if we're not customizing them
  if (!customSplit) return getEqualWeights(weights.length);

  // Get current sum and distribute the difference equally so it adds to 1
  const sum = weights.reduce((sum, w) => sum + w, 0);
  const diff = (sum - 1) / weights.length;
  const newWeights = weights.map((w) => floatRound(w - diff));

  // With rounding, the end result might be slightly off and need an adjustment
  const adjustment = floatRound(newWeights.reduce((sum, w) => sum + w, -1));
  if (adjustment) {
    const i = newWeights.findIndex((w) => w >= adjustment);
    if (i >= 0) {
      newWeights[i] = floatRound(newWeights[i] - adjustment);
    }
  }

  return newWeights;
}

export function percentToDecimal(val: string, precision: number = 4): number {
  return parseFloat((parseFloat(val) / 100).toFixed(precision));
}
export function decimalToPercent(val: number, precision: number = 4): number {
  return parseFloat((val * 100).toFixed(precision - 2));
}
export function floatRound(val: number, precision: number = 4): number {
  return parseFloat(val.toFixed(precision));
}

// Updates one of the variation weights and rebalances
// the rest of the weights to keep the sum equal to 1
export function rebalance(
  weights: number[],
  i: number,
  newValue: number,
  precision: number = 4
): number[] {
  // Clamp new value
  if (newValue > 1) newValue = 1;
  if (newValue < 0) newValue = 0;

  // Update the new value
  weights = [...weights];
  weights[i] = newValue;

  // Current sum of weights
  const currentTotal = floatRound(
    weights.reduce((sum, w) => sum + w, 0),
    precision
  );
  // The sum is too low, increment the next variation's weight
  if (currentTotal < 1) {
    const nextIndex = (i + 1) % weights.length;
    const nextValue = floatRound(weights[nextIndex], precision);
    weights[(i + 1) % weights.length] = floatRound(
      nextValue + (1 - currentTotal),
      precision
    );
  } else if (currentTotal > 1) {
    // The sum is too high, loop through the other variations and decrement weights
    let overage = floatRound(currentTotal - 1, precision);
    let j = 1;
    while (overage > 0 && j < weights.length) {
      const nextIndex = (j + i) % weights.length;
      const nextValue = floatRound(weights[nextIndex], precision);
      const adjustedValue =
        nextValue >= overage ? floatRound(nextValue - overage, precision) : 0;
      overage = floatRound(overage - (nextValue - adjustedValue), precision);
      weights[nextIndex] = adjustedValue;
      j++;
    }
  }

  return weights;
}

export function isNullUndefinedOrEmpty(x): boolean {
  if (x === null) return true;
  if (x === undefined) return true;
  if (x === "") return true;
  if (typeof x === "object" && !Object.keys(x).length) return true;
  return false;
}

export function appendQueryParamsToURL(
  url: string,
  params: Record<string, string | number | undefined>
): string {
  const [root, query] = url.split("?");
  const parsed = qs.parse(query ?? "");
  const queryParams = qs.stringify({ ...parsed, ...params });
  return `${root}?${queryParams}`;
}

export function capitalizeFirstLetter(string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export function capitalizeWords(string): string {
  return string
    .split(" ")
    .map((word) => capitalizeFirstLetter(word))
    .join(" ");
}

export async function sha256(str): Promise<string> {
  try {
    const buffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(str)
    );
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    console.error(e);
  }
  return "";
}
