import { hash, toString } from "../../util";
import type { Attributes } from "../../types/growthbook";
import { readSessionJSON, writeSessionJSON } from "./storage";

type StoredDecision = {
  scopeId: string;
  sampled: boolean;
};

// Write-through copy so the decision sticks within the page even when
// sessionStorage is unavailable
const decisions = new Map<string, StoredDecision>();

// True-random sampling with a decision that sticks for the given scope
// (e.g. one replay session), so reloads don't re-roll mid-scope. A new
// scopeId rolls fresh.
export function shouldSampleScope({
  rate,
  storageKey,
  scopeId,
  random = Math.random,
}: {
  rate: number;
  storageKey: string;
  scopeId: string;
  random?: () => number;
}): boolean {
  const stored =
    (readSessionJSON(storageKey) as StoredDecision | null) ||
    decisions.get(storageKey);
  if (
    stored &&
    stored.scopeId === scopeId &&
    typeof stored.sampled === "boolean"
  ) {
    return stored.sampled;
  }

  const sampled = rate >= 1 || (rate > 0 && random() < rate);
  persistSampleDecision(storageKey, scopeId, sampled);
  return sampled;
}

// Record an explicit decision for a scope (e.g. a programmatically forced
// recording), so reloads within the scope honor it over the sample rate.
export function persistSampleDecision(
  storageKey: string,
  scopeId: string,
  sampled: boolean,
): void {
  const decision = { scopeId, sampled };
  decisions.set(storageKey, decision);
  writeSessionJSON(storageKey, decision);
}

export function _resetSampleDecisionsForTests(): void {
  decisions.clear();
}

// One seed for every auto-events category keeps their cohorts nested: a
// user inside a 10% cohort is inside every larger one, so cwv, errors, and
// clicks for the same user arrive together
export const DEFAULT_SAMPLING_SEED = "gb-events";

const warnedMissing = new Set<string>();

// Deterministic hash-based sampling: a stable cohort per attribute value
export function shouldSample({
  rate,
  hashAttribute,
  attributes,
  seed = "",
}: {
  rate: number;
  hashAttribute?: string;
  attributes?: Attributes;
  seed?: string;
}) {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const attributeValue = hashAttribute
    ? attributes
      ? attributes[hashAttribute]
      : undefined
    : undefined;
  const samplingValue = toString(attributeValue);
  if (typeof samplingValue === "string") {
    const v = hash(seed, samplingValue, 2);
    return v !== null && v < rate;
  }
  if (hashAttribute && !warnedMissing.has(hashAttribute)) {
    warnedMissing.add(hashAttribute);
    console.warn(
      `Sampling attribute "${hashAttribute}" is not set; falling back to a random roll`,
    );
  }
  return Math.random() < rate;
}

// Bad rates warn and fall back rather than throw — an observability typo
// must never take the SDK down with it
export function normalizeSamplingRate(
  rate: number | undefined,
  fallback: number,
  label: string,
): number {
  if (rate === undefined) return fallback;
  if (typeof rate !== "number" || !isFinite(rate) || rate < 0 || rate > 1) {
    console.warn(
      `${label} must be between 0 and 1 (got ${rate}); using ${fallback}`,
    );
    return fallback;
  }
  return rate;
}
