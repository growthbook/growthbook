import { sameCanonicalValue } from "shared/util";
import { hasAttributeCondition } from "shared/experiments";
import { ExperimentTargetingData } from "shared/types/experiment";

const TRAFFIC_FIELDS = new Set<keyof ExperimentTargetingData>([
  "coverage",
  "variationWeights",
  "variations",
]);

/** Targeting as a change is judged: "{}" and "" both mean no condition. */
export function comparableTargeting(
  targeting: ExperimentTargetingData,
): ExperimentTargetingData {
  return {
    ...targeting,
    condition: hasAttributeCondition(targeting.condition)
      ? targeting.condition
      : "",
  };
}

/**
 * Whether staged targeting changes only traffic and variations. Those save with
 * the experiment's other changes, which leaves a running bandit's learning
 * alone; anything else saves as targeting, which restarts it.
 */
export function onlyTrafficChanged(
  staged: ExperimentTargetingData,
  stored: ExperimentTargetingData,
): boolean {
  const [s, t] = [comparableTargeting(staged), comparableTargeting(stored)];
  const keys = Object.keys({ ...t, ...s }) as Array<
    keyof ExperimentTargetingData
  >;
  return keys.every(
    (key) => TRAFFIC_FIELDS.has(key) || sameCanonicalValue(s[key], t[key]),
  );
}

/**
 * Staged targeting onto what's stored now, from the `base` it was staged
 * against: a field only someone else changed since takes theirs, and one both
 * changed differently is contested and keeps mine.
 */
export function mergeStagedTargeting(
  base: ExperimentTargetingData,
  staged: ExperimentTargetingData,
  current: ExperimentTargetingData,
): {
  merged: ExperimentTargetingData;
  contested: (keyof ExperimentTargetingData)[];
} {
  const [b, s, c] = [base, staged, current].map(comparableTargeting);
  const keys = Object.keys({ ...b, ...s, ...c }) as Array<
    keyof ExperimentTargetingData
  >;
  const merged = { ...current };
  const contested: (keyof ExperimentTargetingData)[] = [];
  for (const key of keys) {
    if (sameCanonicalValue(s[key], b[key])) continue;
    Object.assign(merged, { [key]: staged[key] });
    if (
      !sameCanonicalValue(c[key], b[key]) &&
      !sameCanonicalValue(c[key], s[key])
    ) {
      contested.push(key);
    }
  }
  return { merged, contested };
}
