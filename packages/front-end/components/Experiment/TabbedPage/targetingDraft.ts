import isEqual from "lodash/isEqual";
import { ExperimentTargetingData } from "shared/types/experiment";

const TRAFFIC_FIELDS = new Set<keyof ExperimentTargetingData>([
  "coverage",
  "variationWeights",
  "variations",
]);

/**
 * Whether staged targeting changes only traffic and variations. Those save with
 * the experiment's other changes, which leaves a running bandit's learning
 * alone; anything else saves as targeting, which restarts it.
 */
export function onlyTrafficChanged(
  staged: ExperimentTargetingData,
  stored: ExperimentTargetingData,
): boolean {
  const keys = Object.keys({ ...stored, ...staged }) as Array<
    keyof ExperimentTargetingData
  >;
  return keys.every(
    (key) => TRAFFIC_FIELDS.has(key) || isEqual(staged[key], stored[key]),
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
  const keys = Object.keys({ ...base, ...staged, ...current }) as Array<
    keyof ExperimentTargetingData
  >;
  const merged = { ...current };
  const contested: (keyof ExperimentTargetingData)[] = [];
  for (const key of keys) {
    if (isEqual(staged[key], base[key])) continue;
    Object.assign(merged, { [key]: staged[key] });
    if (
      !isEqual(current[key], base[key]) &&
      !isEqual(current[key], staged[key])
    ) {
      contested.push(key);
    }
  }
  return { merged, contested };
}
