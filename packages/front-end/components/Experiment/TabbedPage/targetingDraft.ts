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
